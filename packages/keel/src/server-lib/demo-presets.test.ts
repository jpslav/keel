import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

// The server replay of a demo preset, against keel's OWN seam: the fixture registers `busy-harbor`
// (packages/keel/test-fixture/app-config/presets.ts), one operation of every kind plus a viewpoint, and
// `busy-harbor-lead`, which extends it with no operations of its own and a different viewpoint. Its
// script includes the fixture's OWN kind, `docket.flag`, acting on the docket its inbound email opened
// (named `crane`), and its `flag` step runs the fixture's REPLACEMENT of keel's `flag` half
// (test-fixture/app-config/preset-operations.ts).
// Same throwaway-dir + mocked-cookie-jar setup as fake/auth.test.ts (the viewpoint is a cookie), and
// next-intl's server translator is stubbed: the invite email's copy is not what is under test here. The
// adapter registry is `server-only`, so it is replaced by the simulated-mode registry it would build —
// the fake adapters themselves, unmocked, which is the whole path the replay drives.
const tmp = mkdtempSync(path.join(tmpdir(), 'app-demo-presets-'))
beforeAll(() => {
    process.env.APP_DATA_DIR = tmp
})
afterAll(() => {
    delete process.env.APP_DATA_DIR
})

const cookieStore = new Map<string, { value: string }>()
vi.mock('next/headers', () => ({
    cookies: async () => ({
        get: (name: string) => cookieStore.get(name),
        set: (name: string, value: string) => cookieStore.set(name, { value }),
        delete: (name: string) => cookieStore.delete(name),
    }),
}))
vi.mock('../adapters/index', async () => ({
    isSimulated: true,
    auth: (await import('../adapters/fake/auth')).fakeAuth,
    db: (await import('../adapters/fake/db')).fakeDb,
    email: (await import('../adapters/fake/email')).fakeEmail,
    analytics: (await import('../adapters/fake/analytics')).fakeAnalytics,
}))
vi.mock('next-intl/server', () => ({
    getTranslations: async () => (key: string) => key,
}))

const BASE_URL = 'http://localhost:3000/api/simulator/presets'
const INVITEE = 'new.hand@example.test'

async function harborTenantId(): Promise<string> {
    const { fakeDb } = await import('../adapters/fake/db')
    await fakeDb.ready()
    const tenant = await fakeDb
        .getDb()
        .selectFrom('tenants')
        .select('id')
        .where('slug', '=', 'harbor')
        .executeTakeFirstOrThrow()
    return tenant.id
}

async function depotDocketLabels(): Promise<string[]> {
    const { fakeDb } = await import('../adapters/fake/db')
    const rows = await fakeDb.withTenant(await harborTenantId(), (trx) =>
        trx.selectFrom('dockets').select('label').execute(),
    )
    return rows.map((row) => row.label)
}

describe('applyDemoPreset (server host)', () => {
    test('resets, replays every operation through the server paths, and signs the restorer in', async () => {
        const { applyDemoPreset } = await import('./demo-presets')
        const { fakeAuth } = await import('../adapters/fake/auth')
        const { listCaughtEmails } = await import('../adapters/fake/email')
        const { readFlags } = await import('../adapters/fake/analytics')
        const { readActorHolds, readViewpointCookie } = await import('../adapters/fake/simulator')

        const result = await applyDemoPreset('busy-harbor', { baseUrl: BASE_URL })

        expect(result).toEqual({ signedIn: true })
        // invite: a pending membership, and its email in the invitee's inbox with an accept link on THIS host
        const depot = await fakeAuth.listMembers('depot')
        expect(depot.filter((member) => member.status === 'invited').map((member) => member.email)).toEqual([INVITEE])
        const inviteMail = listCaughtEmails().filter((mail) => mail.to === INVITEE)
        expect(inviteMail).toHaveLength(1)
        expect(inviteMail[0]!.html).toContain('http://localhost:3000/en/accept-invite?invite=')
        // inbound: the fixture's registered handler opened a docket from the email
        expect(await depotDocketLabels()).toContain('Crane four is stuck')
        // flag
        expect(readFlags()['jobs-held']).toBe(true)
        // actor.hold: the fixture's one actor is held, in the file the actor host's `held` route reads
        expect(readActorHolds()).toEqual({ 'fixture-tug': true })
        // viewpoint: THIS browser now sits at fixture-hand's desk
        expect((await fakeAuth.getCurrentUser())?.id).toBe('fixture-hand')
        expect(await readViewpointCookie()).toBe('person:fixture-hand')
    })

    test('an actor hold lasts until the world is reset: the next load starts from none, a reset leaves none', async () => {
        const { applyDemoPreset } = await import('./demo-presets')
        const { readActorHolds, setActorHold } = await import('../adapters/fake/simulator')
        const { resetWorld } = await import('../adapters/fake/simulator-admin')

        // a hold the preset does not make must not survive the load (replaying resets the world first)
        setActorHold('fixture-barge', true)
        await applyDemoPreset('busy-harbor', { baseUrl: BASE_URL })
        expect(readActorHolds()).toEqual({ 'fixture-tug': true })

        await resetWorld()
        expect(readActorHolds()).toEqual({})
    })

    test('a named result flows: the docket the inbound handler opened is the one the app kind flags', async () => {
        const { applyDemoPreset } = await import('./demo-presets')
        const { fakeDb } = await import('../adapters/fake/db')

        await applyDemoPreset('busy-harbor', { baseUrl: BASE_URL })

        const tenantId = await harborTenantId()
        const dockets = await fakeDb.withTenant(tenantId, (trx) =>
            trx.selectFrom('dockets').select(['id', 'label', 'status']).execute(),
        )
        const crane = dockets.find((docket) => docket.label === 'Crane four is stuck')
        // `crane` named the row the fixture's support handler INSERTED (its uuid, via subjectId), and the
        // fixture's `docket.flag` half resolved that name — so exactly that docket is flagged, by its `by`.
        expect(crane?.status).toBe('flagged')
        expect(dockets.filter((docket) => docket.status === 'flagged').map((docket) => docket.id)).toEqual([crane?.id])
        const flagged = await fakeDb.withTenant(tenantId, (trx) =>
            trx
                .selectFrom('audit_events')
                .select(['actor_user_id', 'subject_id'])
                .where('action', '=', 'docket.flagged')
                .execute(),
        )
        expect(flagged).toEqual([{ actor_user_id: 'fixture-lead', subject_id: crane?.id }])
    })

    test("an app half registered under keel's kind name replaces keel's: the fixture's `flag` is the one that ran", async () => {
        const { applyDemoPreset } = await import('./demo-presets')
        const { replacedFlagCalls } = await import('@app-config/preset-operations')
        const { readFlags, setFlag } = await import('../adapters/fake/analytics')

        replacedFlagCalls.length = 0
        setFlag('jobs-held', false)
        await applyDemoPreset('busy-harbor', { baseUrl: BASE_URL })

        expect(replacedFlagCalls).toEqual([{ flag: 'jobs-held', enabled: true }])
        // ...and it wrapped keel's half rather than dropping it, so the flag is still set
        expect(readFlags()['jobs-held']).toBe(true)
    })

    test('a preset that extends another replays the base first, then sits the restorer down at its own viewpoint', async () => {
        const { applyDemoPreset } = await import('./demo-presets')
        const { fakeAuth } = await import('../adapters/fake/auth')
        const { listCaughtEmails } = await import('../adapters/fake/email')
        const { readFlags, setFlag } = await import('../adapters/fake/analytics')

        setFlag('jobs-held', false) // so the flag below can only be the inherited operation's doing
        const result = await applyDemoPreset('busy-harbor-lead', { baseUrl: BASE_URL })

        expect(result).toEqual({ signedIn: true })
        // everything busy-harbor does, inherited: the invite and its email, the docket, the flag...
        const depot = await fakeAuth.listMembers('depot')
        expect(depot.filter((member) => member.status === 'invited').map((member) => member.email)).toEqual([INVITEE])
        expect(listCaughtEmails().filter((mail) => mail.to === INVITEE)).toHaveLength(1)
        expect(await depotDocketLabels()).toContain('Crane four is stuck')
        expect(readFlags()['jobs-held']).toBe(true)
        // ...and the viewpoint is the child's own, not the base's `fixture-hand`
        expect((await fakeAuth.getCurrentUser())?.id).toBe('fixture-lead')
    })

    test('replaying is idempotent: the reset underneath means a second load is the same world, not twice it', async () => {
        const { applyDemoPreset } = await import('./demo-presets')
        const { fakeAuth } = await import('../adapters/fake/auth')
        const { setFlag, readFlags } = await import('../adapters/fake/analytics')

        setFlag('demo-banner', true) // a change the preset does not make — must not survive the load
        await applyDemoPreset('busy-harbor', { baseUrl: BASE_URL })

        const invited = (await fakeAuth.listMembers('depot')).filter((member) => member.status === 'invited')
        expect(invited).toHaveLength(1)
        expect((await depotDocketLabels()).filter((label) => label === 'Crane four is stuck')).toHaveLength(1)
        expect(readFlags()['demo-banner'] ?? false).toBe(false)
    })

    test('an unknown preset is a 404-shaped error, and the world is left untouched', async () => {
        const { applyDemoPreset } = await import('./demo-presets')
        const { NotFoundError } = await import('../ports/errors')

        await expect(applyDemoPreset('no-such-preset', { baseUrl: BASE_URL })).rejects.toBeInstanceOf(NotFoundError)
        expect(await depotDocketLabels()).toContain('Crane four is stuck')
    })

    test('a saved snapshot may not take a preset id or "reset" — a tour would resolve it differently per host', async () => {
        const { saveSnapshot } = await import('../adapters/fake/simulator-admin')
        const { ForbiddenError } = await import('../ports/errors')

        await expect(saveSnapshot('busy-harbor')).rejects.toBeInstanceOf(ForbiddenError)
        await expect(saveSnapshot('reset')).rejects.toBeInstanceOf(ForbiddenError)
        await expect(saveSnapshot('my-checkpoint')).resolves.toBeUndefined()
    })
})
