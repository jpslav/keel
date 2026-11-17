import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { makeTestTmpDir } from '../../../../tests/support/tmp-dir'
import type { DbPort } from '../ports/db'
import type { AuditDetail, AuditEventInput } from './audit'
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

describe('recordAuditEvent detail', () => {
    test('records a detail as jsonb and reads it back; a writer that passes none records NULL', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { recordAuditEvent } = await import('./audit')
        const { tenantId, orgId } = await ids('harbor', 'depot')

        const withDetail = `docket-${Date.now()}-detail`
        const without = `docket-${Date.now()}-none`
        const detail = { refusal: 'revoked', removed: 3, steps: ['a', 'b'], nested: { ok: true, none: null } }
        // A type with an optional property, as an adopter would write one; the property is left undefined.
        const withOptional: typeof detail & { hint?: string } = { ...detail, hint: undefined }
        await recordAuditEvent(fakeDb, {
            tenantId,
            orgId,
            actorUserId: 'system:scheduler',
            action: 'membership.invited',
            subjectType: 'Membership',
            subjectId: withDetail,
            // An optional property left undefined is written as JSON writes it: absent.
            detail: withOptional,
        })
        await recordAuditEvent(fakeDb, {
            tenantId,
            orgId,
            actorUserId: 'system:scheduler',
            action: 'membership.invited',
            subjectType: 'Membership',
            subjectId: without,
        })

        const rows = await fakeDb.withTenant(tenantId, (trx) =>
            trx
                .selectFrom('audit_events')
                .select(['subject_id', 'detail'])
                .where('subject_id', 'in', [withDetail, without])
                .orderBy('subject_id')
                .execute(),
        )
        expect(rows).toEqual([
            { subject_id: withDetail, detail },
            { subject_id: without, detail: null },
        ])
    })

    test('the type refuses a Date, a function and an explicit undefined', async () => {
        const ok: AuditDetail = { refusal: 'expired', removed: 0, ids: ['a'], nested: { flag: false, none: null } }
        // @ts-expect-error a Date is not JSON
        const date: AuditDetail = { at: new Date(0) }
        // @ts-expect-error neither is a function
        const fn: AuditDetail = { run: () => 1 }
        // @ts-expect-error nor undefined
        const undef: AuditDetail = { gone: undefined }
        expect([ok, date, fn, undef]).toHaveLength(4)
    })

    // A DbPort that fails if anything opens: a refused detail must be refused before any transaction.
    const OPENED = 'stub: a transaction was opened'
    const unopenable: DbPort = {
        getDb: () => {
            throw new Error(OPENED)
        },
        withTenant: () => Promise.reject(new Error(OPENED)),
        ready: () => Promise.resolve(),
        migrateToLatest: () => Promise.resolve(),
    }

    async function attempt(detail: unknown): Promise<string> {
        const { recordAuditEvent } = await import('./audit')
        try {
            await recordAuditEvent(unopenable, {
                tenantId: 't',
                orgId: 'o',
                actorUserId: 'system:scheduler',
                action: 'membership.invited',
                subjectType: 'Membership',
                detail: detail as AuditDetail,
            })
        } catch (error) {
            return error instanceof Error ? error.message : String(error)
        }
        return 'no error'
    }

    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    const symbolKeyed = { ok: 1, [Symbol('s')]: 2 }
    const holed: number[] = []
    holed[0] = 1
    holed[2] = 3

    test.each([
        ['an array at the top', [1, 2], 'detail is not an object'],
        ['a string at the top', 'revoked', 'detail is not an object'],
        ['a Date', { at: new Date(0) }, 'detail.at is not a plain object'],
        ['a Map', { m: new Map() }, 'detail.m is not a plain object'],
        ['a function', { run: () => 1 }, 'detail.run is a function'],
        ['undefined in an array', { list: [1, undefined] }, 'detail.list[1] is undefined'],
        ['a bigint', { n: BigInt(1) }, 'detail.n is a bigint'],
        ['NaN', { n: Number.NaN }, 'detail.n is not a finite number'],
        ['Infinity', { n: Number.POSITIVE_INFINITY }, 'detail.n is not a finite number'],
        ['a hole in an array', { list: holed }, 'detail.list[1] is undefined'],
        ['a symbol key', symbolKeyed, 'detail has a symbol key'],
        ['five levels', { a: { b: { c: { d: { e: 1 } } } } }, 'detail.a.b.c.d nests deeper than 4 levels'],
        ['a cycle', cycle, 'nests deeper than 4 levels'],
        ['a NUL character', { s: 'a\u0000b' }, 'detail.s holds a NUL character'],
        ['an unpaired surrogate', { s: 'a\uD800b' }, 'detail.s holds an unpaired surrogate'],
        ['a key named token', { token: 'x' }, 'detail.token names a secret'],
        ['a camelCase secret', { accessToken: 'x' }, 'detail.accessToken names a secret'],
        ['a snake_case api key', { api_key: 'x' }, 'detail.api_key names a secret'],
        ['an apiKey', { apiKey: 'x' }, 'detail.apiKey names a secret'],
        ['a client secret', { clientSecret: 'x' }, 'detail.clientSecret names a secret'],
        ['a plural that is not a count', { passwords: ['x'] }, 'detail.passwords names secrets, and is not a count'],
        ['a plural holding a string', { revokedTokens: 'many' }, 'detail.revokedTokens names secrets'],
        ['an accessKey', { accessKey: 'x' }, 'detail.accessKey names a secret'],
        ['an AWS secret key name', { aws_secret_access_key: 'x' }, 'detail.aws_secret_access_key names a secret'],
        ['a secretAccessKey', { secretAccessKey: 'x' }, 'detail.secretAccessKey names a secret'],
        ['an encryptionKey', { encryptionKey: 'x' }, 'detail.encryptionKey names a secret'],
        ['a pwd', { pwd: 'x' }, 'detail.pwd names a secret'],
        ['a passcode', { passcode: 'x' }, 'detail.passcode names a secret'],
        ['a PEM', { privateKeyPem: 'x' }, 'detail.privateKeyPem names a secret'],
        ['a bare plural holding a number', { otps: 482913 }, 'detail.otps names secrets'],
        ['a numeric code under a singular', { otp: 482913 }, 'detail.otp names a secret'],
        ['a pin', { pin: '4821' }, 'detail.pin names a secret'],
        ['a totp', { totp: '482913' }, 'detail.totp names a secret'],
        ['a password hash', { passwordHash: 'x' }, 'detail.passwordHash names a secret'],
        ['an OAuth refresh token', { refresh_token: 'x' }, 'detail.refresh_token names a secret'],
        ['an API key header', { 'x-api-key': 'x' }, 'detail.x-api-key names a secret'],
        ['a card number', { cardNumber: '4111111111111111' }, 'detail.cardNumber names a secret'],
        ['a card security code', { cvv: 123 }, 'detail.cvv names a secret'],
        ['a social security number', { ssn: 'x' }, 'detail.ssn names a secret'],
        ['a numbered password', { password2: 'x' }, 'detail.password2 names a secret'],
        ['a versioned api key', { apiKey_v2: 'x' }, 'detail.apiKey_v2 names a secret'],
        ['an -es plural', { passwordHashes: ['x'] }, 'detail.passwordHashes names secrets'],
        ['a header name', { Authorization: 'x' }, 'detail.Authorization names a secret'],
        ['a kebab-case cookie', { 'set-cookie': 'x' }, 'detail.set-cookie names a secret'],
        ['a nested secret', { items: [{ ok: 1 }, { privateKey: 'x' }] }, 'detail.items[1].privateKey names a secret'],
    ])('refuses %s, naming the rule and the path', async (_name, detail, message) => {
        expect(await attempt(detail)).toContain(message)
    })

    // Secret-SHAPED values are built here rather than written out: a credential-shaped literal in source
    // reads as a committed secret to a scanner and to a reader (.gitleaks.toml, the keyset note).
    const jwtShaped = ['eyJhbGciOiJSUzI1NiJ9', 'eyJzdWIiOiJ4In0', 'c2ln'].join('.')
    const bearerShaped = `Bearer ${'fixture'.repeat(3)}`
    const plantedSecret = ['fixture', 'planted', 'value'].join('-')

    test.each([
        ['an email address', { reason: 'sender jo.doe@example.test is not a member' }, 'looks like an email address'],
        ['a JWT', { seen: jwtShaped }, 'looks like a JWT'],
        ['a Bearer credential', { header: bearerShaped }, 'looks like a Bearer credential'],
        ['an address with an accented domain', { member: 'josé@bücher.de' }, 'looks like an email address'],
        ['an address in another script', { member: '李@例子.中国' }, 'looks like an email address'],
        ['an address with a suffix', { member: 'alice@example.com_admin' }, 'looks like an email address'],
        ['a Devanagari address', { member: 'संपर्क@डाटामेल.भारत' }, 'looks like an email address'],
        ['a Thai address', { member: 'user@ตัวอย่าง.ไทย' }, 'looks like an email address'],
        ['a Tamil address', { member: 'user@உதாரணம்.இந்தியா' }, 'looks like an email address'],
        [
            'credentials in a URL',
            { dsn: 'postgres://app:hunter2@db.internal.example/keel' },
            'looks like an email address',
        ],
    ])('refuses a value shaped like %s, and never repeats it', async (_name, detail, message) => {
        const refused = await attempt(detail)
        expect(refused).toContain(message)
        expect(refused).not.toContain(String(Object.values(detail)[0]))
    })

    test.each([
        ['a non-finite number', { 'jane.doe@example.com': Number.NaN }, 'is not a finite number'],
        ['a Date', { [jwtShaped]: new Date(0) }, 'is not a plain object'],
        ['an undefined in an array', { by: { 'jane.doe@example.com': [undefined] } }, 'is undefined'],
        ['a very long key', { ['k'.repeat(5000)]: Number.NaN }, 'is not a finite number'],
    ])('a refusal under %s never repeats an unsafe key in its path', async (_name, detail, message) => {
        const refused = await attempt(detail)
        expect(refused).toContain(message)
        expect(refused).toContain('<key withheld>')
        expect(refused).not.toContain('jane.doe')
        expect(refused).not.toContain('eyJ')
        expect(refused).not.toContain('kkkk')
    })

    test('a key shaped like an email address is refused without repeating it', async () => {
        const refused = await attempt({ 'jo.doe@example.test': 1 })
        expect(refused).toContain('detail has a key that looks like an email address')
        expect(refused).not.toContain('jo.doe')
    })

    test('a secret under a key that names it is refused without repeating the value', async () => {
        const refused = await attempt({ sessionToken: plantedSecret })
        expect(refused).toContain('names a secret')
        expect(refused).not.toContain(plantedSecret)
    })

    test.each([
        ['tokenId', { tokenId: 'tok-1' }],
        ['tokenCount', { tokenCount: 2 }],
        ['tokensRemoved', { tokensRemoved: 42 }],
        ['passwordChangedAt', { passwordChangedAt: '2026-11-17' }],
        ['keyId', { keyId: 'key-1' }],
        ['a refusal code', { refusal: 'revoked' }],
        ['a count of revoked tokens', { revokedTokens: 3 }],
        ['a count of stale cookies', { staleCookies: 2 }],
        ['a count of revoked api keys', { revokedApiKeys: 3 }],
        ['a flag under a secret name', { refusal: 'unknown', missingToken: true }],
        ['a false flag', { hadPassword: false }],
        ['a null under a secret name', { apiKey: null }],
        ['a token limit', { maxTokens: 1000, outputTokens: 12 }],
        ['a reset count', { passwordResetCount: 2 }],
        ['a flag about a pin', { hasPin: true, pinRequired: false }],
        ['a count of input tokens', { inputTokens: 512 }],
        ['a package version', { adapter: 'mailgun.js@4.1.0' }],
        ['a refusal that mentions a bearer', { refusal: 'bearer missing' }],
        ['an optional property left undefined', { outcome: 'ok', hint: undefined }],
        ['four levels', { a: { b: { c: { d: 1 } } } }],
    ])('lets %s through to the write', async (_name, detail) => {
        expect(await attempt(detail)).toBe(OPENED)
    })

    test('checks what JSON.stringify makes of the detail, since that is what is written', async () => {
        // An array whose own toJSON swaps in a secret: its elements pass, its JSON does not.
        const swapped = Object.assign(['ok'], { toJSON: () => ({ password: 'hunter2' }) })
        expect(await attempt({ list: swapped })).toContain('detail.list.password names a secret')

        // A hidden toJSON on the top object.
        const hidden = { outcome: 'ok' }
        Object.defineProperty(hidden, 'toJSON', { value: () => ({ reason: 'jo.doe@example.test' }) })
        const refused = await attempt(hidden)
        expect(refused).toContain('detail.reason looks like an email address')
        expect(refused).not.toContain('jo.doe')

        // A getter that answers one thing to the check and another to the write.
        let reads = 0
        const flipping = {
            get reason() {
                reads += 1
                return reads === 1 ? 'fine' : 'jo.doe@example.test'
            },
        }
        expect(await attempt(flipping)).toContain('detail.reason looks like an email address')

        // A toJSON that serializes to nothing at all.
        const nothing = {}
        Object.defineProperty(nothing, 'toJSON', { value: () => undefined })
        expect(await attempt(nothing)).toContain('detail cannot be serialized as JSON')

        // And a toJSON that JSON cannot serialize at all.
        const unserializable = { outcome: 'ok' }
        Object.defineProperty(unserializable, 'toJSON', { value: () => ({ n: BigInt(1) }) })
        expect(await attempt(unserializable)).toContain('detail cannot be serialized as JSON')
    })

    test('bounds the serialized detail before any pattern reads a value', async () => {
        const { AUDIT_DETAIL_MAX_BYTES } = await import('./audit')
        // An address up front: had the patterns run first, this would be refused as an email address.
        const spread = { note: `jo.doe@example.test ${'x'.repeat(AUDIT_DETAIL_MAX_BYTES)}` }
        expect(await attempt(spread)).toContain('bytes of JSON, over the')
        // A long string no pattern matches is refused by its size alone, not scanned first. (Scanning
        // 60 KB with the email pattern took seconds when the patterns ran first.)
        const started = performance.now()
        expect(await attempt({ note: 'x'.repeat(60_000) })).toContain('detail is 60011 bytes of JSON')
        expect(performance.now() - started).toBeLessThan(1500)
    })

    test('bounds the JSON in bytes, not characters, and says by how much', async () => {
        const { AUDIT_DETAIL_MAX_BYTES } = await import('./audit')
        // `{"s":"…"}` is 8 bytes around the string.
        const atBound = { s: 'x'.repeat(AUDIT_DETAIL_MAX_BYTES - 8) }
        expect(await attempt(atBound)).toBe(OPENED)
        const overByOne = { s: 'x'.repeat(AUDIT_DETAIL_MAX_BYTES - 7) }
        expect(await attempt(overByOne)).toContain(
            `detail is ${AUDIT_DETAIL_MAX_BYTES + 1} bytes of JSON, over the ${AUDIT_DETAIL_MAX_BYTES}-byte bound`,
        )
        // Two bytes a character: under the bound in characters, over it in bytes.
        const accented = { s: 'é'.repeat(AUDIT_DETAIL_MAX_BYTES / 2) }
        expect(JSON.stringify(accented).length).toBeLessThan(AUDIT_DETAIL_MAX_BYTES)
        expect(await attempt(accented)).toContain('bytes of JSON, over the')
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
