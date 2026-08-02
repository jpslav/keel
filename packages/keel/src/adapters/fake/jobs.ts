import { jobHandlers, serviceManagedOrgSlugs } from '@app-config/jobs'
import { isJobKind, type JobStatus } from '../../core/jobs'
import { InvalidTransitionError } from '../../core/state-machine'
import { type JobTimelineEntry, loadTimelines, recordJobStatus, toIso } from '../../db/jobs'
import { NotFoundError } from '../../ports/errors'
import type { JobsPort, SubmittedJob } from '../../ports/jobs'
import { readFlags } from './analytics'
import { fakeAuth, personLocale } from './auth'
import { fakeDb } from './db'
import { fakeEmail } from './email'
import { fakeLlm } from './llm'
import { fakeSendSms } from './sms'
import { fakeStorage } from './storage'

/** Simulator flag: when set, submitted jobs stay 'queued' so an operator can step them forward. */
export const JOBS_HELD_FLAG = 'jobs-held'

function isHeld(): boolean {
    return readFlags()[JOBS_HELD_FLAG] === true
}

/**
 * Notify the job's org admins that a user-facing job reached a terminal state. Best-effort:
 * a notification failure must never fail the job. The fan-out module is DYNAMICALLY imported so this
 * adapter never statically depends on @/server-lib/notify (which pulls @/adapters via defer/sms) — the
 * dispatchWebhook dynamic-import trick that keeps the fake off the @/adapters cycle. The seam filters
 * to user-facing kinds and resolves the org itself, so passing the three facts is enough.
 */
async function notifyTerminal(job: SubmittedJob, status: 'completed' | 'failed'): Promise<void> {
    try {
        const { notifyJobTerminal } = await import('../../server-lib/notify')
        await notifyJobTerminal(
            { db: fakeDb, email: fakeEmail, sms: fakeSendSms, resolveLocale: personLocale },
            fakeAuth,
            { tenantId: job.tenantId, jobId: job.id, status },
        )
    } catch {
        // Notification is a side effect of a completed job, never a reason to fail it.
    }
}

/**
 * Runs a submitted job to completion in-process. recordJobStatus enforces the state machine, so an
 * instant fake still records queued -> running -> completed (or -> failed) — the exact transitions
 * the real CodeBuild path will report via the service-authenticated jobs webhook. Never checks
 * the held flag itself: holding only gates fakeJobs.start(); runPendingJobs() steps held jobs
 * forward deliberately.
 */
async function executeJob(job: SubmittedJob): Promise<boolean> {
    await fakeDb.ready()
    try {
        await recordJobStatus(fakeDb, job.tenantId, job.id, 'running')
    } catch (error) {
        // A concurrent runner (a second run-pending click racing an instant start) already claimed
        // this job — losing that race is benign, not a 500.
        if (error instanceof InvalidTransitionError) return false
        throw error
    }
    if (!isJobKind(job.kind)) {
        await recordJobStatus(fakeDb, job.tenantId, job.id, 'failed', { error: `unknown job kind: ${job.kind}` })
        return true
    }
    try {
        const { resultKey } = await jobHandlers[job.kind](job.payload, {
            db: fakeDb,
            storage: fakeStorage,
            email: fakeEmail,
            llm: fakeLlm,
            tenantId: job.tenantId,
            orgId: job.orgId,
            jobId: job.id,
        })
        await recordJobStatus(fakeDb, job.tenantId, job.id, 'completed', { resultKey })
        await notifyTerminal(job, 'completed')
    } catch (error) {
        await recordJobStatus(fakeDb, job.tenantId, job.id, 'failed', {
            error: error instanceof Error ? error.message : String(error),
        })
        await notifyTerminal(job, 'failed')
    }
    return true
}

export const fakeJobs: JobsPort = {
    async start(job) {
        // Held world (Simulator): leave the job queued for a later runPendingJobs() step. Otherwise
        // run it to completion instantly — the fake's whole point is a synchronous, inspectable world.
        if (isHeld()) return
        await executeJob(job)
    },
}

/** One row of the simulated-mode cross-tenant world view (NOT part of JobsPort). */
export interface WorldJob {
    id: string
    kind: string
    status: JobStatus
    tenantSlug: string
    orgSlug: string | null
    createdAt: string
    resultKey: string | null
    error: string | null
    timeline: JobTimelineEntry[]
}

/**
 * Every job across ALL tenants, joined to tenant/org slugs, newest first (cap 50), timelines
 * embedded — the Simulator Jobs tab's world view. A raw getDb() read on purpose: this is the
 * simulated-world god view, deliberately reaching past the tenant RLS scope (simulated-mode-only).
 */
export async function listWorldJobs(): Promise<WorldJob[]> {
    await fakeDb.ready()
    const db = fakeDb.getDb()
    const rows = await db
        .selectFrom('jobs')
        .innerJoin('tenants', 'tenants.id', 'jobs.tenant_id')
        .leftJoin('organizations', 'organizations.id', 'jobs.org_id')
        .select([
            'jobs.id as id',
            'jobs.kind as kind',
            'jobs.status as status',
            'jobs.result_key as result_key',
            'jobs.error as error',
            'jobs.created_at as created_at',
            'tenants.slug as tenant_slug',
            'organizations.slug as org_slug',
        ])
        .orderBy('jobs.created_at', 'desc')
        .limit(50)
        .execute()
    if (rows.length === 0) return []
    const timelines = await loadTimelines(
        db,
        rows.map((r) => r.id),
    )
    return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        status: r.status as JobStatus,
        tenantSlug: r.tenant_slug,
        orgSlug: r.org_slug,
        createdAt: toIso(r.created_at),
        resultKey: r.result_key,
        error: r.error,
        timeline: timelines.get(r.id) ?? [],
    }))
}

/**
 * Executes every currently-queued job across all tenants and returns how many actually ran (a job
 * claimed by a concurrent runner mid-loop is skipped, not counted). The operator's "step the held
 * world forward" action (Simulator) — runs jobs regardless of the held flag.
 */
export async function runPendingJobs(): Promise<number> {
    await fakeDb.ready()
    const pending = await fakeDb
        .getDb()
        .selectFrom('jobs')
        .select(['id', 'kind', 'tenant_id', 'org_id', 'payload'])
        .where('status', '=', 'queued')
        .orderBy('created_at', 'asc')
        .execute()
    let ran = 0
    for (const job of pending) {
        const executed = await executeJob({
            id: job.id,
            kind: job.kind,
            tenantId: job.tenant_id,
            orgId: job.org_id,
            payload: job.payload,
        })
        if (executed) ran += 1
    }
    return ran
}

/** One pending build the builder-console actor may deliver a completion webhook for (NOT part of
 *  JobsPort). Structurally the component's PendingBuildLike — the actor twin's local view. */
export interface PendingBuild {
    jobId: string
    tenantId: string
    tenantSlug: string
    orgSlug: string | null
    kind: string
    status: 'queued' | 'running'
    createdAt: string
}

/**
 * The builder-console actor's work pool: every NON-terminal job (queued or running) across all
 * tenants whose org is NOT a service-managed one (or has no org at all), oldest-first, joined to
 * tenant/org slugs. Deliberately reaches past the tenant RLS scope via the raw god-view handle —
 * same simulated-mode-only justification as listWorldJobs, beside which it lives. Excluding the
 * service-managed orgs keeps the two actors' pools disjoint (see serviceManagedOrgSlugs in
 * src/app-config/jobs.ts).
 */
export async function listPendingBuilds(): Promise<PendingBuild[]> {
    await fakeDb.ready()
    const rows = await fakeDb
        .getDb()
        .selectFrom('jobs')
        .innerJoin('tenants', 'tenants.id', 'jobs.tenant_id')
        .leftJoin('organizations', 'organizations.id', 'jobs.org_id')
        .select([
            'jobs.id as id',
            'jobs.kind as kind',
            'jobs.status as status',
            'jobs.tenant_id as tenant_id',
            'jobs.created_at as created_at',
            'tenants.slug as tenant_slug',
            'organizations.slug as org_slug',
        ])
        .where('jobs.status', 'in', ['queued', 'running'])
        .orderBy('jobs.created_at', 'asc')
        .execute()
    return rows
        .filter((r) => r.org_slug === null || !serviceManagedOrgSlugs.includes(r.org_slug))
        .map((r) => ({
            jobId: r.id,
            tenantId: r.tenant_id,
            tenantSlug: r.tenant_slug,
            orgSlug: r.org_slug,
            kind: r.kind,
            status: r.status as 'queued' | 'running',
            createdAt: toIso(r.created_at),
        }))
}

/**
 * (Re)produces a job's artifact by running its handler — artifact production ONLY, NEVER a status
 * write (the actor reports status separately over the genuine service/webhook surface, so the
 * timeline stays authored by those calls, not by this one). Loads the job row via the god-view
 * handle; an unknown (tenantId, jobId) pair is a NotFoundError (→ 404 at the route). An unknown kind
 * or a throwing handler returns `{ error }` so the actor can truthfully report the job failed.
 * Idempotent: re-running overwrites the same storage key.
 */
export async function produceJobArtifact(
    tenantId: string,
    jobId: string,
): Promise<{ resultKey: string } | { error: string }> {
    await fakeDb.ready()
    const row = await fakeDb
        .getDb()
        .selectFrom('jobs')
        .select(['id', 'kind', 'tenant_id', 'org_id', 'payload'])
        .where('id', '=', jobId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst()
    if (!row) throw new NotFoundError(`unknown job: ${jobId}`)
    if (!isJobKind(row.kind)) return { error: `unknown job kind: ${row.kind}` }
    try {
        const { resultKey } = await jobHandlers[row.kind](row.payload, {
            db: fakeDb,
            storage: fakeStorage,
            email: fakeEmail,
            llm: fakeLlm,
            tenantId: row.tenant_id,
            orgId: row.org_id,
            jobId: row.id,
        })
        if (!resultKey) return { error: 'handler produced no artifact' }
        return { resultKey }
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
    }
}
