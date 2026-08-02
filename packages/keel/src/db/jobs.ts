import { sql, type Kysely, type Transaction } from 'kysely'
import { exportKeyPrefix, type JobStatus, jobStatusMachine } from '../core/jobs'
import { InvalidTransitionError } from '../core/state-machine'
import type { DbPort } from '../ports/db'
import { NotFoundError } from '../ports/errors'
import type { JobsPort } from '../ports/jobs'
import type { DB } from './schema'
import { enqueueWebhookEvent } from './webhooks'

export interface JobTimelineEntry {
    status: JobStatus
    message: string | null
    at: string
}

export interface JobView {
    id: string
    kind: string
    status: JobStatus
    createdAt: string
    resultKey: string | null
    error: string | null
    timeline: JobTimelineEntry[]
}

/** timestamptz comes back from both pglite and real Postgres as a Date; views expose ISO strings. */
export function toIso(value: unknown): string {
    return value instanceof Date ? value.toISOString() : String(value)
}

/**
 * Submits a job: one tenant-scoped transaction persists the `jobs` row and its opening 'queued'
 * timeline entry together, THEN — only once that has committed — hands off to the execution seam
 * so the handler (fake: in-process; real: CodeBuild) can never observe a job that isn't durable yet.
 */
export async function submitJob(
    db: DbPort,
    jobs: JobsPort,
    input: { tenantId: string; orgId: string | null; kind: string; payload: unknown },
): Promise<{ id: string }> {
    const { id } = await db.withTenant(input.tenantId, async (trx) => {
        const job = await trx
            .insertInto('jobs')
            .values({ tenant_id: input.tenantId, org_id: input.orgId, kind: input.kind, payload: input.payload })
            .returning('id')
            .executeTakeFirstOrThrow()
        await trx
            .insertInto('job_status_changes')
            .values({ tenant_id: input.tenantId, job_id: job.id, status: 'queued', message: null })
            .execute()
        return job
    })
    await jobs.start({ id, kind: input.kind, tenantId: input.tenantId, orgId: input.orgId, payload: input.payload })
    return { id }
}

/**
 * THE choke point for every status change. One tenant-scoped transaction locks the job row
 * (FOR UPDATE — concurrent transitions for the same job serialize instead of double-writing under
 * pooled Postgres, e.g. a webhook redelivery), asserts the hop is legal (a bad transition throws
 * InvalidTransitionError and rolls back), updates the job row, and appends an immutable timeline
 * entry. Callers racing to *start* a job should treat InvalidTransitionError as "someone else
 * already did" — see the fake executor.
 */
export async function recordJobStatus(
    db: DbPort,
    tenantId: string,
    jobId: string,
    next: JobStatus,
    extra?: { message?: string; resultKey?: string; error?: string },
): Promise<void> {
    const job = await db.withTenant(tenantId, async (trx) => {
        const current = await trx
            .selectFrom('jobs')
            .select(['status', 'org_id', 'kind'])
            .where('id', '=', jobId)
            .forUpdate()
            .executeTakeFirstOrThrow()
        jobStatusMachine.assertTransition(current.status as JobStatus, next)
        await trx
            .updateTable('jobs')
            .set({
                status: next,
                updated_at: sql`now()`,
                ...(extra?.resultKey !== undefined ? { result_key: extra.resultKey } : {}),
                ...(extra?.error !== undefined ? { error: extra.error } : {}),
            })
            .where('id', '=', jobId)
            .execute()
        await trx
            .insertInto('job_status_changes')
            .values({ tenant_id: tenantId, job_id: jobId, status: next, message: extra?.message ?? null })
            .execute()
        return { orgId: current.org_id, kind: current.kind }
    })

    // Outbound webhooks: a job status change is an emitted event. Enqueue only — cheap; the
    // drain delivers async. Deliberately AFTER the status transaction commits (the audit precedent),
    // and skipped when the job has no org (RLS-proof / legacy rows can't have subscribed endpoints).
    if (job.orgId) {
        await enqueueWebhookEvent(db, {
            tenantId,
            orgId: job.orgId,
            kind: 'job.status_changed',
            payload: { jobId, jobKind: job.kind, status: next, orgId: job.orgId },
        })
    }
}

/**
 * Lists a team's jobs newest-first, each with its full timeline embedded (two queries, one
 * transaction). Org-filtered — the team collaboration boundary, an app-level WHERE on top of the
 * tenant RLS scope (the same shape an app’s own list route has).
 */
export async function listJobs(
    db: DbPort,
    tenantId: string,
    orgId: string,
    opts?: { kind?: string; limit?: number },
): Promise<JobView[]> {
    const limit = opts?.limit ?? 20
    return db.withTenant(tenantId, async (trx) => {
        const rows = await trx
            .selectFrom('jobs')
            .select(['id', 'kind', 'status', 'result_key', 'error', 'created_at'])
            .where('org_id', '=', orgId)
            .$if(opts?.kind !== undefined, (qb) => qb.where('kind', '=', opts!.kind!))
            .orderBy('created_at', 'desc')
            .limit(limit)
            .execute()
        if (rows.length === 0) return []
        const timelines = await loadTimelines(
            trx,
            rows.map((r) => r.id),
        )
        return rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            status: r.status as JobStatus,
            createdAt: toIso(r.created_at),
            resultKey: r.result_key,
            error: r.error,
            timeline: timelines.get(r.id) ?? [],
        }))
    })
}

/** A job as an external service caller sees it: no timeline (polling stays light), payload included. */
export interface ServiceJobView {
    id: string
    kind: string
    status: JobStatus
    payload: unknown
    createdAt: string
    resultKey: string | null
    error: string | null
}

/**
 * The service-caller poll view: an org's jobs newest-first, optionally filtered by status, WITHOUT
 * timelines (a poller wants current state, not the whole history — keep it light). Tenant-scoped by
 * RLS AND org-filtered, same two boundaries as listJobs. Default limit 50.
 */
export async function listServiceJobs(
    db: DbPort,
    tenantId: string,
    orgId: string,
    opts?: { status?: JobStatus; limit?: number },
): Promise<ServiceJobView[]> {
    const limit = opts?.limit ?? 50
    return db.withTenant(tenantId, async (trx) => {
        const rows = await trx
            .selectFrom('jobs')
            .select(['id', 'kind', 'status', 'payload', 'result_key', 'error', 'created_at'])
            .where('org_id', '=', orgId)
            .$if(opts?.status !== undefined, (qb) => qb.where('status', '=', opts!.status!))
            .orderBy('created_at', 'desc')
            .limit(limit)
            .execute()
        return rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            status: r.status as JobStatus,
            payload: r.payload,
            createdAt: toIso(r.created_at),
            resultKey: r.result_key,
            error: r.error,
        }))
    })
}

/**
 * Resolves a job id to its status ONLY when it belongs to `orgId` within `tenantId` — returns null
 * both when the job is absent and when it belongs to another org (a foreign org's job must be
 * indistinguishable from a missing one, so a caller can't probe other teams' job ids).
 */
export async function jobForOrg(
    db: DbPort,
    tenantId: string,
    orgId: string,
    jobId: string,
): Promise<{ id: string; status: JobStatus } | null> {
    return db.withTenant(tenantId, async (trx) => {
        const row = await trx
            .selectFrom('jobs')
            .select(['id', 'status'])
            .where('id', '=', jobId)
            .where('org_id', '=', orgId)
            .executeTakeFirst()
        return row ? { id: row.id, status: row.status as JobStatus } : null
    })
}

/**
 * Idempotent inbound-webhook completion (the real CodeBuild build's final POST reports terminal
 * status here). NotFoundError when the job isn't in the tenant. If the job is already in the
 * requested terminal state → 'idempotent' (a webhook redelivery is expected, not an error). A job
 * still 'queued' walks through 'running' (message 'completion webhook') first so the timeline always
 * reads queued -> running -> terminal. Every write goes through recordJobStatus (the row-locked
 * choke point).
 *
 * The webhook payload names the tenant, but the ORG namespace a resultKey may live in is the job
 * row's to decide — a planted same-tenant foreign-org key dies here as 'invalid-result-key' (the
 * service status route enforces the same prefix from its caller identity).
 *
 * Two deliveries can race the same still-queued job: the loser's mid-walk InvalidTransitionError is
 * resolved by LOOKING AGAIN — idempotent when the world reached the requested state, one more walk
 * while it's still in flight — never by bouncing the vendor with the 409 the idempotent-redelivery
 * contract exists to avoid. A genuinely illegal hop (completed -> failed) still throws immediately
 * via the terminal pre-check. The retry bound is generous: after one lost race the job is at least
 * 'running', so the next walk is single-hop.
 */
export async function recordWebhookCompletion(
    db: DbPort,
    input: { tenantId: string; jobId: string; status: 'completed' | 'failed'; resultKey?: string; error?: string },
): Promise<'applied' | 'idempotent' | 'invalid-result-key'> {
    const extra = { resultKey: input.resultKey, error: input.error }
    for (let attempt = 0; ; attempt++) {
        const row = await db.withTenant(input.tenantId, (trx) =>
            trx.selectFrom('jobs').select(['status', 'org_id']).where('id', '=', input.jobId).executeTakeFirst(),
        )
        if (!row) throw new NotFoundError(`job not found in tenant: ${input.jobId}`)
        if (input.resultKey !== undefined && !input.resultKey.startsWith(exportKeyPrefix(input.tenantId, row.org_id))) {
            return 'invalid-result-key'
        }
        const current = row.status as JobStatus
        if (current === input.status) return 'idempotent'
        if (jobStatusMachine.isTerminal(current)) jobStatusMachine.assertTransition(current, input.status)
        try {
            if (current === 'queued') {
                await recordJobStatus(db, input.tenantId, input.jobId, 'running', { message: 'completion webhook' })
            }
            await recordJobStatus(db, input.tenantId, input.jobId, input.status, extra)
            return 'applied'
        } catch (error) {
            if (error instanceof InvalidTransitionError && attempt < 2) continue
            throw error
        }
    }
}

/**
 * Resolves a job's kind + owning org by id within a tenant (RLS-scoped) — the notification fan-out
 * needs both to decide whether a terminal job is user-facing and to address the org's admins.
 * Null when the job isn't in the tenant. A thin read, deliberately not folded into recordJobStatus so
 * the status choke point stays free of the notification/adapters layer (the webhook-enqueue precedent).
 */
export async function jobKindAndOrg(
    db: DbPort,
    tenantId: string,
    jobId: string,
): Promise<{ kind: string; orgId: string | null } | null> {
    return db.withTenant(tenantId, async (trx) => {
        const row = await trx.selectFrom('jobs').select(['kind', 'org_id']).where('id', '=', jobId).executeTakeFirst()
        return row ? { kind: row.kind, orgId: row.org_id } : null
    })
}

/**
 * Loads timeline entries for the given job ids (chronological), grouped by job. Accepts either a
 * tenant-scoped transaction (product paths) or the raw handle (the simulated-mode cross-tenant world view).
 */
export async function loadTimelines(
    executor: Kysely<DB> | Transaction<DB>,
    jobIds: string[],
): Promise<Map<string, JobTimelineEntry[]>> {
    const changes = await executor
        .selectFrom('job_status_changes')
        .select(['job_id', 'status', 'message', 'at'])
        .where('job_id', 'in', jobIds)
        .orderBy('at', 'asc')
        .execute()
    const grouped = new Map<string, JobTimelineEntry[]>()
    for (const change of changes) {
        const list = grouped.get(change.job_id) ?? []
        list.push({ status: change.status as JobStatus, message: change.message, at: toIso(change.at) })
        grouped.set(change.job_id, list)
    }
    return grouped
}
