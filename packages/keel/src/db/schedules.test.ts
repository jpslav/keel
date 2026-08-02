import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { ScheduleSpec } from '../core/schedules'
import type { JobsPort, SubmittedJob } from '../ports/jobs'

// Point all fake-adapter state at a throwaway dir BEFORE importing anything that touches pglite.
const tmp = mkdtempSync(path.join(tmpdir(), 'app-schedules-db-'))
beforeAll(() => {
    process.env.APP_DATA_DIR = tmp
})
afterAll(() => {
    delete process.env.APP_DATA_DIR
})

/** A JobsPort that records every start() call — the scan under test spawns through this seam. */
function stubJobs(): { port: JobsPort; calls: SubmittedJob[] } {
    const calls: SubmittedJob[] = []
    return {
        port: {
            async start(job) {
                calls.push(job)
            },
        },
        calls,
    }
}

/** Count how many spawned jobs carry a given scheduleId payload — robust against the seeded schedule. */
function firedFor(calls: SubmittedJob[], scheduleId: string): number {
    return calls.filter((c) => (c.payload as { scheduleId?: string }).scheduleId === scheduleId).length
}

async function primaryOrgIds(): Promise<{ tenantId: string; orgId: string }> {
    const { fakeDb } = await import('../adapters/fake/db')
    await fakeDb.ready()
    const tenant = await fakeDb
        .getDb()
        .selectFrom('tenants')
        .select('id')
        .where('slug', '=', 'harbor')
        .executeTakeFirstOrThrow()
    const org = await fakeDb
        .getDb()
        .selectFrom('organizations')
        .select('id')
        .where('tenant_id', '=', tenant.id)
        .where('slug', '=', 'depot')
        .executeTakeFirstOrThrow()
    return { tenantId: tenant.id, orgId: org.id }
}

async function insertSchedule(opts: { nextRunAt: Date; enabled?: boolean; spec?: ScheduleSpec }): Promise<string> {
    const { fakeDb } = await import('../adapters/fake/db')
    const { tenantId, orgId } = await primaryOrgIds()
    const spec: ScheduleSpec = opts.spec ?? { type: 'weekly', utcDay: 1, atUtcHour: 13, atUtcMinute: 0 }
    const row = await fakeDb
        .getDb()
        .insertInto('job_schedules')
        .values({
            tenant_id: tenantId,
            org_id: orgId,
            kind: 'digest-email',
            spec,
            next_run_at: opts.nextRunAt,
            enabled: opts.enabled ?? true,
            created_by: 'test',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    return row.id
}

async function nextRunAt(scheduleId: string): Promise<Date> {
    const { fakeDb } = await import('../adapters/fake/db')
    const row = await fakeDb
        .getDb()
        .selectFrom('job_schedules')
        .select('next_run_at')
        .where('id', '=', scheduleId)
        .executeTakeFirstOrThrow()
    return new Date(row.next_run_at)
}

describe('runDueSchedules', () => {
    test('spawns a job for a due schedule, advances next_run_at, and records an audit event', async () => {
        const { runDueSchedules } = await import('./schedules')
        const { fakeDb } = await import('../adapters/fake/db')
        const now = new Date('2026-07-23T14:00:00.000Z')
        const id = await insertSchedule({ nextRunAt: new Date('2026-07-23T13:00:00.000Z') })

        const jobs = stubJobs()
        const { spawned } = await runDueSchedules(fakeDb, jobs.port, now)

        expect(firedFor(jobs.calls, id)).toBe(1)
        expect(spawned).toBeGreaterThanOrEqual(1)
        // next_run_at advanced strictly past `now`.
        expect((await nextRunAt(id)).getTime()).toBeGreaterThan(now.getTime())
        // A jobs row now exists for this schedule's org, and an audit event was recorded.
        const spawnedJob = jobs.calls.find((c) => (c.payload as { scheduleId?: string }).scheduleId === id)!
        const jobRow = await fakeDb
            .getDb()
            .selectFrom('jobs')
            .select(['kind', 'status'])
            .where('id', '=', spawnedJob.id)
            .executeTakeFirst()
        expect(jobRow?.kind).toBe('digest-email')
        const audit = await fakeDb
            .getDb()
            .selectFrom('audit_events')
            .select(['action', 'subject_type'])
            .where('subject_id', '=', id)
            .executeTakeFirst()
        expect(audit).toEqual({ action: 'schedule.fired', subject_type: 'JobSchedule' })
    })

    test('is idempotent: a second scan at the same now does not double-spawn', async () => {
        const { runDueSchedules } = await import('./schedules')
        const { fakeDb } = await import('../adapters/fake/db')
        const now = new Date('2026-07-23T14:00:00.000Z')
        const id = await insertSchedule({ nextRunAt: new Date('2026-07-23T13:00:00.000Z') })

        const jobs = stubJobs()
        await runDueSchedules(fakeDb, jobs.port, now)
        await runDueSchedules(fakeDb, jobs.port, now) // second tick — row already advanced past now
        expect(firedFor(jobs.calls, id)).toBe(1)
    })

    test('coalesces missed periods: a long-overdue schedule fires once and skips to a future slot', async () => {
        const { runDueSchedules } = await import('./schedules')
        const { fakeDb } = await import('../adapters/fake/db')
        const now = new Date('2026-07-23T14:00:00.000Z')
        // Three weeks overdue — must fire ONCE, not three times, and land in the future.
        const id = await insertSchedule({ nextRunAt: new Date('2026-07-02T13:00:00.000Z') })

        const jobs = stubJobs()
        await runDueSchedules(fakeDb, jobs.port, now)
        expect(firedFor(jobs.calls, id)).toBe(1)
        expect((await nextRunAt(id)).getTime()).toBeGreaterThan(now.getTime())
    })

    test('a malformed spec fails that schedule alone: other due schedules still fire', async () => {
        const { runDueSchedules } = await import('./schedules')
        const { fakeDb } = await import('../adapters/fake/db')
        const now = new Date('2026-07-23T14:00:00.000Z')
        const bad = await insertSchedule({
            nextRunAt: new Date('2026-07-23T13:00:00.000Z'),
            spec: { type: 'bogus' } as unknown as ScheduleSpec,
        })
        const good = await insertSchedule({ nextRunAt: new Date('2026-07-23T13:30:00.000Z') })

        const jobs = stubJobs()
        const { failed } = await runDueSchedules(fakeDb, jobs.port, now)
        expect(firedFor(jobs.calls, bad)).toBe(0)
        expect(firedFor(jobs.calls, good)).toBe(1)
        expect(failed).toBeGreaterThanOrEqual(1)
        // The bad row's next_run_at never advanced — it stays due and will retry (and re-fail) next tick.
        expect((await nextRunAt(bad)).getTime()).toBeLessThanOrEqual(now.getTime())
    })

    test('skips not-due and disabled schedules', async () => {
        const { runDueSchedules } = await import('./schedules')
        const { fakeDb } = await import('../adapters/fake/db')
        const now = new Date('2026-07-23T14:00:00.000Z')
        const future = await insertSchedule({ nextRunAt: new Date('2026-07-30T13:00:00.000Z') })
        const disabled = await insertSchedule({ nextRunAt: new Date('2026-07-23T13:00:00.000Z'), enabled: false })

        const jobs = stubJobs()
        await runDueSchedules(fakeDb, jobs.port, now)
        expect(firedFor(jobs.calls, future)).toBe(0)
        expect(firedFor(jobs.calls, disabled)).toBe(0)
    })
})
