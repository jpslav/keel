import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { makeTestTmpDir } from '../../../../../tests/support/tmp-dir'
import { APP_SLUG } from '@app-config/identity'

// Point all fake-adapter state at a throwaway dir BEFORE importing the module (fake-adapters.test.ts pattern).
const tmp = makeTestTmpDir('app-simulator-')
beforeAll(() => {
    process.env.APP_DATA_DIR = tmp
})
afterAll(() => {
    delete process.env.APP_DATA_DIR
})

// next/headers' cookies() throws outside a request scope (confirmed against this Next version);
// stand in with a tiny in-memory jar so the cookie helpers are exercisable in a unit test.
const cookieStore = new Map<string, { value: string }>()
vi.mock('next/headers', () => ({
    cookies: async () => ({
        get: (name: string) => cookieStore.get(name),
        set: (name: string, value: string) => cookieStore.set(name, { value }),
        delete: (name: string) => cookieStore.delete(name),
    }),
}))

describe('simulator continuity state', () => {
    test('round-trips through the state file and merges patches per person', async () => {
        const { updatePersonState, readSimulatorState } = await import('./simulator')

        updatePersonState('person:fixture-lead', { lastPath: '/en/org' })
        updatePersonState('person:fixture-lead', { activeOrgSlug: 'annex' })

        const state = readSimulatorState()
        expect(state.people['person:fixture-lead']).toEqual({
            lastPath: '/en/org',
            activeOrgSlug: 'annex',
        })
    })

    test('recordLastPath is a convenience wrapper keyed by person id', async () => {
        const { recordLastPath, readSimulatorState } = await import('./simulator')

        recordLastPath('fixture-hand', '/en/dashboard')

        expect(readSimulatorState().people['person:fixture-hand']?.lastPath).toBe('/en/dashboard')
    })

    test('viewpoint cookie round-trips and rejects malformed values', async () => {
        const { readViewpointCookie, writeViewpointCookie } = await import('./simulator')

        expect(await readViewpointCookie()).toBeNull()

        await writeViewpointCookie('person:fixture-lead')
        expect(await readViewpointCookie()).toBe('person:fixture-lead')

        cookieStore.set(`${APP_SLUG}_simulator_viewpoint`, { value: 'nonsense' })
        expect(await readViewpointCookie()).toBeNull()
    })
})
