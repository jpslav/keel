import { describe, expect, test } from 'vitest'
import {
    type ActorLogEntry,
    type ActorNoteT,
    builderTick,
    type BuilderDriver,
    type DeliverOutcome,
    type ServiceDriver,
    type ServiceMemory,
    serviceTick,
    type HopOutcome,
    type PendingBuildLike,
    type ServiceJobLike,
} from './actor-runtime'

// A translator that echoes the key — tests assert on which note fired, not on its prose.
const t: ActorNoteT = (key) => key

function sink() {
    const entries: ActorLogEntry[] = []
    const log = (entry: { line: string; note?: string }) => entries.push({ at: 'x', ...entry })
    const notes = () => entries.map((e) => e.note).filter((n): n is string => n !== undefined)
    return { log, entries, notes }
}

function job(id: string, status: ServiceJobLike['status'], createdAt: string): ServiceJobLike {
    return { id, kind: 'export-dockets', status, createdAt }
}

function build(jobId: string, createdAt: string): PendingBuildLike {
    return {
        jobId,
        tenantId: 't',
        tenantSlug: 'harbor',
        orgSlug: 'annex',
        kind: 'export-dockets',
        status: 'queued',
        createdAt,
    }
}

/** A scripted service driver recording every hop and returning canned outcomes. */
function serviceDriver(jobs: ServiceJobLike[], outcomes: { claim?: HopOutcome; complete?: HopOutcome } = {}) {
    const claims: string[] = []
    const completes: string[] = []
    const driver: ServiceDriver = {
        listJobs: async () => jobs,
        claim: async (id) => {
            claims.push(id)
            return outcomes.claim ?? 'applied'
        },
        complete: async (id) => {
            completes.push(id)
            return outcomes.complete ?? 'applied'
        },
    }
    return { driver, claims, completes }
}

function memory(claimed: string[] = []): ServiceMemory {
    return { claimed: new Set(claimed) }
}

describe('serviceTick', () => {
    test('claims the oldest queued job and remembers it', async () => {
        const { driver, claims } = serviceDriver([
            job('newer', 'queued', '2020-01-02T00:00:00.000Z'),
            job('older', 'queued', '2020-01-01T00:00:00.000Z'),
        ])
        const mem = memory()
        const { log, notes } = sink()

        await serviceTick(driver, mem, log, t)

        expect(claims).toEqual(['older'])
        expect(mem.claimed.has('older')).toBe(true)
        expect(notes()).toContain('actorNoteClaimed')
    })

    test('completes a running job before claiming any queued one', async () => {
        const { driver, claims, completes } = serviceDriver([
            job('run', 'running', '2020-01-02T00:00:00.000Z'),
            job('que', 'queued', '2020-01-01T00:00:00.000Z'),
        ])
        const mem = memory(['run'])
        const { log, notes } = sink()

        await serviceTick(driver, mem, log, t)

        expect(completes).toEqual(['run'])
        expect(claims).toEqual([]) // at most one mutation, and completion wins
        expect(mem.claimed.has('run')).toBe(false)
        expect(notes()).toContain('actorNoteCompleted')
    })

    test('prunes claimed ids no longer present in the poll, then notes idle', async () => {
        const { driver } = serviceDriver([])
        const mem = memory(['orphan'])
        const { log, notes } = sink()

        await serviceTick(driver, mem, log, t)

        expect(mem.claimed.size).toBe(0)
        expect(notes()).toContain('actorNoteIdle')
    })

    test('a lost race on completion drops the claim and notes it (409)', async () => {
        const { driver, claims } = serviceDriver([job('run', 'running', '2020-01-01T00:00:00.000Z')], {
            complete: 'conflict',
        })
        const mem = memory(['run'])
        const { log, notes } = sink()

        await serviceTick(driver, mem, log, t)

        expect(mem.claimed.has('run')).toBe(false)
        expect(claims).toEqual([])
        expect(notes()).toContain('actorNoteLostRace')
    })

    test('a lost race on claim does not remember the job (409)', async () => {
        const { driver } = serviceDriver([job('que', 'queued', '2020-01-01T00:00:00.000Z')], { claim: 'conflict' })
        const mem = memory()
        const { log, notes } = sink()

        await serviceTick(driver, mem, log, t)

        expect(mem.claimed.size).toBe(0)
        expect(notes()).toContain('actorNoteLostRace')
    })

    test('a vanished job on completion notes it (404)', async () => {
        const { driver } = serviceDriver([job('run', 'running', '2020-01-01T00:00:00.000Z')], { complete: 'gone' })
        const { log, notes } = sink()

        await serviceTick(driver, memory(['run']), log, t)

        expect(notes()).toContain('actorNoteVanished')
    })

    test('a failed completion narrates "reported failed", never "completed"', async () => {
        const { driver } = serviceDriver([job('run', 'running', '2020-01-01T00:00:00.000Z')], { complete: 'failed' })
        const { log, entries, notes } = sink()

        await serviceTick(driver, memory(['run']), log, t)

        expect(notes()).toContain('actorNoteFailedReported')
        expect(notes()).not.toContain('actorNoteCompleted')
        expect(entries.some((e) => e.line.includes('→ 200 failed'))).toBe(true)
    })

    test('performs at most one mutation per tick', async () => {
        const { driver, claims, completes } = serviceDriver([
            job('run', 'running', '2020-01-02T00:00:00.000Z'),
            job('que', 'queued', '2020-01-01T00:00:00.000Z'),
        ])
        await serviceTick(driver, memory(), sink().log, t)

        expect(claims.length + completes.length).toBe(1)
    })

    test('logs the poll as a verbatim GET line', async () => {
        const { driver } = serviceDriver([job('a', 'queued', '2020-01-01T00:00:00.000Z')])
        const { log, entries } = sink()

        await serviceTick(driver, memory(), log, t)

        expect(entries.some((e) => e.line.startsWith('GET /api/service/jobs → 200'))).toBe(true)
        expect(entries.some((e) => e.line.includes('POST /api/service/jobs/a/status'))).toBe(true)
    })
})

/** A scripted builder driver recording deliveries and returning a canned outcome. */
function builderDriver(builds: PendingBuildLike[], outcome: DeliverOutcome = 'applied') {
    const delivered: string[] = []
    const driver: BuilderDriver = {
        listBuilds: async () => builds,
        deliver: async (b) => {
            delivered.push(b.jobId)
            return outcome
        },
    }
    return { driver, delivered }
}

describe('builderTick', () => {
    test('delivers a completion webhook for the oldest build', async () => {
        const { driver, delivered } = builderDriver([
            build('newer', '2020-01-02T00:00:00.000Z'),
            build('older', '2020-01-01T00:00:00.000Z'),
        ])
        const { log, notes } = sink()

        await builderTick(driver, log, t)

        expect(delivered).toEqual(['older'])
        expect(notes()).toContain('actorNoteDelivered')
    })

    test('maps a redelivery to the redelivered note', async () => {
        const { driver } = builderDriver([build('a', '2020-01-01T00:00:00.000Z')], 'idempotent')
        const { log, notes } = sink()

        await builderTick(driver, log, t)

        expect(notes()).toContain('actorNoteRedelivered')
    })

    test('maps a conflict to the moved-on note', async () => {
        const { driver } = builderDriver([build('a', '2020-01-01T00:00:00.000Z')], 'conflict')
        const { log, notes } = sink()

        await builderTick(driver, log, t)

        expect(notes()).toContain('actorNoteMovedOn')
    })

    test('maps a vanished build to the vanished note', async () => {
        const { driver } = builderDriver([build('a', '2020-01-01T00:00:00.000Z')], 'gone')
        const { log, notes } = sink()

        await builderTick(driver, log, t)

        expect(notes()).toContain('actorNoteVanished')
    })

    test('notes idle when there is nothing to build', async () => {
        const { driver, delivered } = builderDriver([])
        const { log, notes } = sink()

        await builderTick(driver, log, t)

        expect(delivered).toEqual([])
        expect(notes()).toContain('actorNoteIdle')
    })
})
