import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { makeTestTmpDir } from '../../../../../tests/support/tmp-dir'
import { APP_SLUG } from '@app-config/identity'

// No fake-auth unit tests existed before Simulator slice 1 — devSignIn/session both round-trip
// through next/headers' cookies(), which throws outside a request scope, so both need the same
// throwaway-dir + mocked-cookie-jar setup as simulator.test.ts.
const tmp = makeTestTmpDir('app-auth-')
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

describe('devSignIn — Simulator continuity', () => {
    test('restores the remembered active org when the person still belongs to it', async () => {
        const { devSignIn, fakeAuth } = await import('./auth')
        const { updatePersonState } = await import('./simulator')

        // fixture-lead belongs to both harbor orgs; 'annex' isn't their FIRST membership, so restoring
        // it can only come from the remembered state rather than from the fallback.
        updatePersonState('person:fixture-lead', { activeOrgSlug: 'annex' })
        await devSignIn('fixture-lead')

        const user = await fakeAuth.getCurrentUser()
        expect(user?.orgSlug).toBe('annex')
    })

    test('falls back to the first membership once the remembered org is no longer valid', async () => {
        const { devSignIn, fakeAuth } = await import('./auth')
        const { updatePersonState } = await import('./simulator')

        // fixture-hand belongs to depot + annex only — 'wharf' is the OTHER tenant's org, so a
        // stale/foreign remembered org must not stick.
        updatePersonState('person:fixture-hand', { activeOrgSlug: 'wharf' })
        await devSignIn('fixture-hand')

        const user = await fakeAuth.getCurrentUser()
        expect(user?.orgSlug).toBe('depot')
    })

    test('also sets the Simulator viewpoint cookie', async () => {
        const { devSignIn } = await import('./auth')

        await devSignIn('fixture-crew')

        expect(cookieStore.get(`${APP_SLUG}_simulator_viewpoint`)?.value).toBe('person:fixture-crew')
    })
})

describe('acceptInvite — Simulator dynamic people (Bob lifecycle)', () => {
    test('throws when the invite does not exist', async () => {
        const { acceptInvite } = await import('./auth')

        await expect(acceptInvite('does-not-exist', { name: 'Bob' })).rejects.toThrow(/unknown invite/)
    })

    test('throws when the trimmed name is empty', async () => {
        const { fakeAuth, acceptInvite } = await import('./auth')
        const membership = await fakeAuth.createInvite({
            email: 'blank-name@example.test',
            role: 'member',
            orgSlug: 'depot',
        })

        await expect(acceptInvite(membership.id, { name: '   ' })).rejects.toThrow(/name is required/)
    })

    test('creates a person, removes the invite, signs them in, and sets the viewpoint cookie', async () => {
        const { fakeAuth, acceptInvite, findInvite, listAllPeople } = await import('./auth')
        const membership = await fakeAuth.createInvite({
            email: 'bob@example.test',
            role: 'member',
            orgSlug: 'depot',
        })

        await acceptInvite(membership.id, { name: '  Bob Newperson  ' })

        // the invite is gone once accepted
        expect(findInvite(membership.id)).toBeUndefined()

        // the new person is a first-class member of listAllPeople — trimmed name, invite's
        // email/role/org carried over, ambient tenant derived from the org, id from the invite id
        const created = listAllPeople().find((p) => p.email === 'bob@example.test')
        expect(created).toMatchObject({
            id: `person-invited-${membership.id.slice(0, 8)}`,
            name: 'Bob Newperson',
            tenantSlug: 'harbor',
            restricted: false,
            memberships: [{ orgSlug: 'depot', role: 'member' }],
        })
        // seeded people are untouched
        expect(listAllPeople().some((p) => p.id === 'fixture-lead')).toBe(true)

        // acceptInvite also signs them straight in and points the viewpoint at them
        const user = await fakeAuth.getCurrentUser()
        expect(user?.name).toBe('Bob Newperson')
        expect(cookieStore.get(`${APP_SLUG}_simulator_viewpoint`)?.value).toBe(`person:${created!.id}`)
    })

    test('the accepted person can devSignIn like any seeded person, and shows active in listMembers', async () => {
        const { devSignIn, fakeAuth, listAllPeople } = await import('./auth')
        const created = listAllPeople().find((p) => p.email === 'bob@example.test')!

        await devSignIn(created.id)
        const signedIn = await fakeAuth.getCurrentUser()
        expect(signedIn?.id).toBe(created.id)

        const members = await fakeAuth.listMembers('depot')
        const member = members.find((m) => m.email === 'bob@example.test')
        expect(member?.status).toBe('active')
        expect(member?.name).toBe('Bob Newperson')
    })
})
