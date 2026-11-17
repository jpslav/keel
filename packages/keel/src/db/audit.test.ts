import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { makeTestTmpDir } from '../../../../tests/support/tmp-dir'
import type { DbPort } from '../ports/db'
import type { AuditEventInput } from './audit'
import { orgIdForSlug } from './org-lookup'
import { tenantIdForSlug } from './tenant-lookup'

// Point all fake-adapter state at a throwaway dir BEFORE importing anything that touches pglite.
const tmp = makeTestTmpDir('app-audit-db-')
beforeAll(() => {
    process.env.APP_DATA_DIR = tmp
})
afterAll(() => {
    delete process.env.APP_DATA_DIR
})

/** Resolve a tenant id and one of its org ids from the seed. */
async function ids(slug: string, orgSlug: string): Promise<{ tenantId: string; orgId: string }> {
    const { fakeDb } = await import('../adapters/fake/db')
    await fakeDb.ready()
    const tenantId = await tenantIdForSlug(fakeDb, slug)
    if (!tenantId) throw new Error(`no tenant: ${slug}`)
    const orgId = await orgIdForSlug(fakeDb, tenantId, orgSlug)
    if (!orgId) throw new Error(`no org: ${orgSlug}`)
    return { tenantId, orgId }
}

describe('recordAuditEvent', () => {
    test('writes a tenant- and org-scoped event with the given action, subject type, and subject id', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { recordAuditEvent } = await import('./audit')
        const { tenantId, orgId } = await ids('harbor', 'depot')

        const subjectId = `member-${Date.now()}`
        await recordAuditEvent(fakeDb, {
            tenantId,
            orgId,
            actorUserId: 'user-ada',
            action: 'membership.invited',
            subjectType: 'Membership',
            subjectId,
        })

        const row = await fakeDb.withTenant(tenantId, (trx) =>
            trx.selectFrom('audit_events').selectAll().where('subject_id', '=', subjectId).executeTakeFirstOrThrow(),
        )
        expect(row.tenant_id).toBe(tenantId)
        expect(row.org_id).toBe(orgId)
        expect(row.actor_user_id).toBe('user-ada')
        expect(row.action).toBe('membership.invited')
        expect(row.subject_type).toBe('Membership')
        expect(row.subject_id).toBe(subjectId)
    })

    test('a subjectless action records a null subject_id (column stays honest)', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { recordAuditEvent } = await import('./audit')
        const { tenantId, orgId } = await ids('harbor', 'depot')

        await recordAuditEvent(fakeDb, {
            tenantId,
            orgId,
            actorUserId: 'user-ada',
            action: 'agreement.accepted',
            subjectType: 'AgreementAcceptance',
        })

        const row = await fakeDb.withTenant(tenantId, (trx) =>
            trx
                .selectFrom('audit_events')
                .selectAll()
                .where('action', '=', 'agreement.accepted')
                .orderBy('at', 'desc')
                .executeTakeFirstOrThrow(),
        )
        expect(row.subject_id).toBeNull()
    })

    test('records the credential an actor used (kind and id), or NULLs when the writer does not say', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { recordAuditEvent } = await import('./audit')
        const { tenantId, orgId } = await ids('harbor', 'depot')

        const byBadge = `docket-${Date.now()}-badge`
        const unsaid = `docket-${Date.now()}-unsaid`
        await recordAuditEvent(fakeDb, {
            tenantId,
            orgId,
            actorUserId: 'fixture-lead',
            credential: { kind: 'fixture-badge', id: 'badge-7' },
            action: 'membership.invited',
            subjectType: 'Membership',
            subjectId: byBadge,
        })
        await recordAuditEvent(fakeDb, {
            tenantId,
            orgId,
            actorUserId: 'system:scheduler',
            action: 'membership.invited',
            subjectType: 'Membership',
            subjectId: unsaid,
        })

        const rows = await fakeDb.withTenant(tenantId, (trx) =>
            trx
                .selectFrom('audit_events')
                .select(['subject_id', 'credential_kind', 'credential_id'])
                .where('subject_id', 'in', [byBadge, unsaid])
                .orderBy('subject_id')
                .execute(),
        )
        expect(rows).toEqual([
            { subject_id: byBadge, credential_kind: 'fixture-badge', credential_id: 'badge-7' },
            { subject_id: unsaid, credential_kind: null, credential_id: null },
        ])
    })
})

/**
 * THE TIME AN AUDIT EVENT CARRIES. The column defaulted to the database's `now()` and nothing set it, so a demo
 * that advanced the Simulator's world clock still recorded events in real time, and anything that compares an
 * event's age with that clock (a retention demo, an "older than 90 days" screen) never lined up. In a simulated
 * world the event now takes the world clock's time, through the database port; in real mode it is the database's
 * own `now()` and there is nothing a caller could pass to change it.
 */
describe('the time an audit event carries', () => {
    const DAY_MS = 86_400_000

    afterEach(async () => {
        const { resetClock } = await import('../adapters/fake/clock')
        resetClock()
    })

    /** Records one event through `port` and returns the instant stored on its row, in ms. */
    async function recordedAt(port: DbPort, extra: Record<string, unknown> = {}): Promise<number> {
        const { fakeDb } = await import('../adapters/fake/db')
        const { recordAuditEvent } = await import('./audit')
        const { tenantId, orgId } = await ids('harbor', 'depot')
        const subjectId = `when-${Date.now()}-${Math.random().toString(36).slice(2)}`
        await recordAuditEvent(port, {
            tenantId,
            orgId,
            actorUserId: 'user-ada',
            action: 'membership.invited',
            subjectType: 'Membership',
            subjectId,
            ...extra,
        })
        const row = await fakeDb.withTenant(tenantId, (trx) =>
            trx.selectFrom('audit_events').select('at').where('subject_id', '=', subjectId).executeTakeFirstOrThrow(),
        )
        return new Date(row.at).getTime()
    }

    test("in a simulated world the event takes the WORLD CLOCK's time, a day on after the clock advanced a day", async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { advanceClockMs } = await import('../adapters/fake/clock')
        advanceClockMs(DAY_MS)

        const before = Date.now()
        const at = await recordedAt(fakeDb)
        const after = Date.now()

        expect(at).toBeGreaterThanOrEqual(before + DAY_MS)
        expect(at).toBeLessThanOrEqual(after + DAY_MS)
    })

    test('resetting the clock returns new events to real time', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { advanceClockMs, resetClock } = await import('../adapters/fake/clock')
        advanceClockMs(DAY_MS)
        resetClock()

        const before = Date.now()
        const at = await recordedAt(fakeDb)

        expect(at).toBeGreaterThanOrEqual(before - 2000)
        expect(at).toBeLessThan(before + DAY_MS / 2)
    })

    test("a database with no clock (what real mode has) stamps the database's own now(), world clock or not", async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { advanceClockMs } = await import('../adapters/fake/clock')
        advanceClockMs(DAY_MS)
        // The fake's pglite, minus the one thing only a simulated world adds: its clock.
        const realLike: DbPort = { ...fakeDb, now: undefined }

        const before = Date.now()
        const at = await recordedAt(realLike)
        const after = Date.now()

        expect(at).toBeGreaterThanOrEqual(before - 2000)
        expect(at).toBeLessThanOrEqual(after + 2000)
    })

    test('a caller cannot set it: there is no `at` to pass, and one smuggled past the types is ignored', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        // Compile-time: `at` is not a key of the input at all. (If someone adds one, this line stops compiling.)
        const noAtKey: 'at' extends keyof AuditEventInput ? never : true = true
        expect(noAtKey).toBe(true)

        // Run-time: forced through anyway, on a database with no world clock, the forged 1970 never reaches the row.
        const realLike: DbPort = { ...fakeDb, now: undefined }
        const before = Date.now()
        const at = await recordedAt(realLike, { at: new Date(0).toISOString() })

        expect(at, 'a forged 1970 time must not reach the row').toBeGreaterThanOrEqual(before - 2000)
    })

    test('a corrupt clock file, or an offset past the Date range, costs the demo its clock and not the app its audit write', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { writeFileSync } = await import('node:fs')
        const path = await import('node:path')
        const clockFile = path.join(tmp, 'simulator', 'clock.json')

        // Unparsable; past the Date range (Invalid Date); and VALID instants Postgres rejects: year 33715 and year -29662.
        for (const bad of ['{"offsetMs": ', '{"offsetMs":1e16}', '{"offsetMs":1e15}', '{"offsetMs":-1e15}']) {
            writeFileSync(clockFile, bad)
            const before = Date.now()
            const at = await recordedAt(fakeDb)
            expect(at, bad).toBeGreaterThanOrEqual(before - 2000)
            expect(at, bad).toBeLessThanOrEqual(Date.now() + 2000)
        }
    })

    test('the real database adapter never defines a clock of its own', async () => {
        // Constructing the pool connects to nothing; it is destroyed at once. The only simulated-world thing a
        // DbPort may add is `now`, and a real adapter that did would make an audit row's time caller-influenced.
        const { createRealDb } = await import('../adapters/real/db')
        const real = createRealDb('postgres://nobody:nothing@127.0.0.1:1/none')
        try {
            expect(real.now).toBeUndefined()
            expect('now' in real).toBe(false)
        } finally {
            await real.getDb().destroy()
        }
    })
})

describe('auditActorOf', () => {
    test('names a person by user id and their credential; one that states none records none, never a guess', async () => {
        const { auditActorOf } = await import('./audit')
        const person = {
            userId: 'fixture-lead',
            role: 'admin',
            restricted: false,
            activeOrgId: 'o',
            manageAll: false,
        } as const
        expect(auditActorOf(person)).toEqual({ actorUserId: 'fixture-lead', credential: null })
        expect(auditActorOf({ ...person, credential: { kind: 'fixture-badge', id: 'badge-7' } })).toEqual({
            actorUserId: 'fixture-lead',
            credential: { kind: 'fixture-badge', id: 'badge-7' },
        })
    })

    test('names a machine by its kind-qualified principal and the credential it presented', async () => {
        const { auditActorOf } = await import('./audit')
        const robot = {
            kind: 'machine',
            credential: { kind: 'service-key', id: 'key-1' },
            principalId: 'service-key:wharf',
            activeOrgId: 'o',
        } as const
        expect(auditActorOf(robot)).toEqual({
            actorUserId: 'service-key:wharf',
            credential: { kind: 'service-key', id: 'key-1' },
        })
    })
})
