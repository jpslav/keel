import { computeNextRunAt, parseScheduleSpec, type ScheduleSpec } from '../core/schedules'
import type { DbPort } from '../ports/db'
import type { JobsPort } from '../ports/jobs'
import { recordAuditEvent } from './audit'
import { toIso } from './jobs'

/** Opaque actor id for the system-initiated scheduler in the audit trail (no user drives a tick). */
const SCHEDULER_ACTOR = 'system:scheduler'

/**
 * Safety bound on the coalesce loop (see computeNextRunAt's drift note). A pathological combination —
 * a 1-minute interval and a world-clock jump of years — is capped here; beyond it we anchor the next
 * run to `now` (losing phase, the acceptable degenerate case) rather than spin.
 */
const MAX_COALESCE = 100_000

/**
 * THE scheduled-work drain. Finds every enabled schedule whose next_run_at is due at `now`,
 * and for each: spawns a job through the EXISTING jobs machinery (the same jobs row + queued timeline
 * the export job uses), records an audit event, and advances next_run_at.
 *
 * `now` is supplied by the caller so the trigger source owns the clock: the real EventBridge tick
 * passes real time; the fake Simulator controls pass the simulated world-clock time (worldNow). A
 * tick belongs to no one tenant, so it enumerates tenants through the raw handle (the `tenants`
 * table carries no RLS — the packages/keel/src/db/tenant-lookup.ts precedent) and then reads each tenant's due
 * schedules INSIDE db.withTenant. That per-tenant shape is load-bearing, not style: `job_schedules`
 * is FORCE RLS, so a raw cross-tenant scan of it would return zero rows on a real Postgres role
 * (only pglite's superuser default made it appear to work), and the tick would silently never fire.
 * Scanning under withTenant needs no privileged role in any mode, and RLS contains every read and
 * write the same way.
 *
 * IDEMPOTENCY. The spawn and the next_run_at advance commit in ONE tenant-scoped transaction that
 * locks the schedule row FOR UPDATE (the recordJobStatus pattern). A second tick racing the same row
 * blocks on the lock, then sees next_run_at already advanced past `now` and skips — a tick that fires
 * twice can never double-spawn. Missed slots (a late tick, or a demo clock-jump across several
 * periods) coalesce: the row advances to the first slot after `now` and fires ONCE, never one job per
 * skipped period. jobs.start() runs only AFTER that transaction commits, exactly as submitJob does, so
 * a handler never observes a job — or a schedule state — that isn't durable yet.
 *
 * FAULT ISOLATION. One bad row (a malformed spec that parseScheduleSpec rejects, a start() failure)
 * must not stall every other schedule: each schedule drains inside its own try/catch, counted in
 * `failed` and retried naturally on the next tick because its next_run_at never advanced.
 */
export async function runDueSchedules(
    db: DbPort,
    jobs: JobsPort,
    now: Date,
): Promise<{ spawned: number; failed: number }> {
    await db.ready()
    const tenants = await db.getDb().selectFrom('tenants').select('id').execute()
    const due: { id: string; tenant_id: string }[] = []
    for (const tenant of tenants) {
        const rows = await db.withTenant(tenant.id, (trx) =>
            trx
                .selectFrom('job_schedules')
                .select('id')
                .where('enabled', '=', true)
                .where('next_run_at', '<=', now)
                .orderBy('next_run_at', 'asc')
                .execute(),
        )
        due.push(...rows.map((r) => ({ id: r.id, tenant_id: tenant.id })))
    }

    let spawned = 0
    let failed = 0
    for (const schedule of due) {
        try {
            spawned += await drainOne(db, jobs, now, schedule)
        } catch {
            failed += 1
        }
    }
    return { spawned, failed }
}

/** Drains one due schedule (the locked spawn+advance transaction, then audit + start). Returns the
 *  number of jobs spawned (0 when the under-lock re-check skips the row). */
async function drainOne(
    db: DbPort,
    jobs: JobsPort,
    now: Date,
    schedule: { id: string; tenant_id: string },
): Promise<number> {
    const result = await db.withTenant(schedule.tenant_id, async (trx) => {
        const locked = await trx
            .selectFrom('job_schedules')
            .select(['enabled', 'spec', 'kind', 'org_id', 'next_run_at'])
            .where('id', '=', schedule.id)
            .forUpdate()
            .executeTakeFirst()
        // Re-check under the lock: enabled may have flipped, or a concurrent tick may have already
        // advanced next_run_at past `now` — either way this tick does nothing for the row.
        if (!locked || !locked.enabled || new Date(locked.next_run_at) > now) return null
        const spec = parseScheduleSpec(locked.spec)

        const job = await trx
            .insertInto('jobs')
            .values({
                tenant_id: schedule.tenant_id,
                org_id: locked.org_id,
                kind: locked.kind,
                payload: { scheduleId: schedule.id },
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        await trx
            .insertInto('job_status_changes')
            .values({ tenant_id: schedule.tenant_id, job_id: job.id, status: 'queued', message: 'scheduled' })
            .execute()

        // Advance from the schedule's OWN scheduled time (anti-drift), coalescing past `now`.
        let next = computeNextRunAt(spec, new Date(locked.next_run_at))
        for (let i = 0; next.getTime() <= now.getTime() && i < MAX_COALESCE; i++) {
            next = computeNextRunAt(spec, next)
        }
        if (next.getTime() <= now.getTime()) next = computeNextRunAt(spec, now)
        await trx.updateTable('job_schedules').set({ next_run_at: next }).where('id', '=', schedule.id).execute()

        return { jobId: job.id, kind: locked.kind, orgId: locked.org_id }
    })
    if (!result) return 0

    // Deliberately non-atomic with the spawn (the house audit pattern — its own transaction after
    // commit): a system-initiated firing, attributed to the scheduler actor.
    await recordAuditEvent(db, {
        tenantId: schedule.tenant_id,
        orgId: result.orgId,
        actorUserId: SCHEDULER_ACTOR,
        action: 'schedule.fired',
        subjectType: 'JobSchedule',
        subjectId: schedule.id,
    })
    await jobs.start({
        id: result.jobId,
        kind: result.kind,
        tenantId: schedule.tenant_id,
        orgId: result.orgId,
        payload: { scheduleId: schedule.id },
    })
    return 1
}

/** One schedule as the Simulator Jobs tab sees it, joined to tenant/org slugs (NOT a product view). */
export interface WorldSchedule {
    id: string
    kind: string
    spec: ScheduleSpec
    nextRunAt: string
    enabled: boolean
    tenantSlug: string
    orgSlug: string
}

/**
 * Every schedule across ALL tenants, joined to tenant/org slugs, ordered by next fire — the Simulator
 * Jobs tab's schedule view. A raw cross-tenant read like the Jobs god-view (simulated-mode-only surface;
 * the route gates it), reaching past the tenant RLS scope on purpose.
 */
export async function listSchedulesForWorld(db: DbPort): Promise<WorldSchedule[]> {
    await db.ready()
    const rows = await db
        .getDb()
        .selectFrom('job_schedules')
        .innerJoin('tenants', 'tenants.id', 'job_schedules.tenant_id')
        .innerJoin('organizations', 'organizations.id', 'job_schedules.org_id')
        .select([
            'job_schedules.id as id',
            'job_schedules.kind as kind',
            'job_schedules.spec as spec',
            'job_schedules.next_run_at as next_run_at',
            'job_schedules.enabled as enabled',
            'tenants.slug as tenant_slug',
            'organizations.slug as org_slug',
        ])
        .orderBy('job_schedules.next_run_at', 'asc')
        .execute()
    return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        spec: parseScheduleSpec(r.spec),
        nextRunAt: toIso(r.next_run_at),
        enabled: r.enabled,
        tenantSlug: r.tenant_slug,
        orgSlug: r.org_slug,
    }))
}
