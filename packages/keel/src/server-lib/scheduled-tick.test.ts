import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { makeTestTmpDir } from '../../../../tests/support/tmp-dir'
import type { JobsPort, SubmittedJob } from '../ports/jobs'

// The registry is the one thing `runScheduledTick` takes from '../adapters/index' (a real import trips
// server-only in a test env), so hand it the fake database and a jobs port that records what the tick spawns.
const state = vi.hoisted(() => ({ calls: [] as SubmittedJob[] }))
vi.mock('../adapters/index', async () => {
    const { fakeDb } = await import('../adapters/fake/db')
    const jobs: JobsPort = {
        async start(job) {
            state.calls.push(job)
        },
    }
    return { db: fakeDb, jobs, isSimulated: true }
})

const tmp = makeTestTmpDir('app-scheduled-tick-')
beforeAll(() => {
    process.env.APP_DATA_DIR = tmp
})
afterAll(() => {
    delete process.env.APP_DATA_DIR
})
afterEach(async () => {
    state.calls.length = 0
    const { resetClock } = await import('../adapters/fake/clock')
    resetClock()
})

const DAY_MS = 86_400_000

/** A schedule on the fixture's harbor/depot org whose next run is `nextRunAt`; returns its id. */
async function insertSchedule(nextRunAt: Date): Promise<string> {
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
    const row = await fakeDb
        .getDb()
        .insertInto('job_schedules')
        .values({
            tenant_id: tenant.id,
            org_id: org.id,
            kind: 'digest-email',
            spec: { type: 'weekly', utcDay: 1, atUtcHour: 13, atUtcMinute: 0 },
            next_run_at: nextRunAt,
            enabled: true,
            created_by: 'test',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    return row.id
}

const firedFor = (scheduleId: string) =>
    state.calls.filter((call) => (call.payload as { scheduleId?: string }).scheduleId === scheduleId).length

describe('runScheduledTick', () => {
    test('spawns the job of a schedule that is due, once, and says how many it spawned', async () => {
        const { runScheduledTick } = await import('./scheduled-tick')
        const id = await insertSchedule(new Date(Date.now() - 60_000))

        const first = await runScheduledTick()
        const second = await runScheduledTick() // the row advanced past now in the first tick

        expect(first.spawned).toBeGreaterThanOrEqual(1)
        expect(first.failed).toBe(0)
        expect(firedFor(id)).toBe(1)
        expect(second.spawned).toBe(0)
        expect(firedFor(id)).toBe(1)
    })

    test('leaves a schedule that is not yet due alone', async () => {
        const { runScheduledTick } = await import('./scheduled-tick')
        const id = await insertSchedule(new Date(Date.now() + 2 * DAY_MS))

        await runScheduledTick()

        expect(firedFor(id)).toBe(0)
    })

    test("in a simulated world it ticks on the Simulator's world clock, so advancing the clock fires the schedule", async () => {
        const { runScheduledTick } = await import('./scheduled-tick')
        const { advanceClockMs } = await import('../adapters/fake/clock')
        const id = await insertSchedule(new Date(Date.now() + 2 * DAY_MS))

        await runScheduledTick()
        expect(firedFor(id), 'not due in real time').toBe(0)

        advanceClockMs(3 * DAY_MS)
        await runScheduledTick()
        expect(firedFor(id), 'due once the world clock is three days on').toBe(1)
    })

    test('reports the outbound-delivery drain beside the schedules', async () => {
        const { runScheduledTick } = await import('./scheduled-tick')
        const result = await runScheduledTick()
        expect(result.deliveries).toEqual({
            delivered: expect.any(Number),
            failed: expect.any(Number),
            dead: expect.any(Number),
        })
    })
})
