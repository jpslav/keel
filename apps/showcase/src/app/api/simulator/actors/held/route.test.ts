import { afterEach, describe, expect, test, vi } from 'vitest'

// One mutable hoisted control surface exercises BOTH the production-containment 404 (simulated mode off)
// and the simulated-mode answers (sibling test: ../builds/route.test.ts). The stores are mocked so the test
// needs no data dir; their own persistence is proven where they live (keel's simulator.test.ts).
const state = vi.hoisted(() => ({
    fake: false,
    flags: {} as Record<string, boolean>,
    holds: {} as Record<string, boolean>,
}))

vi.mock('keel/adapters/index', () => ({
    get isSimulated() {
        return state.fake
    },
}))
vi.mock('keel/adapters/fake/analytics', () => ({ readFlags: () => state.flags }))
vi.mock('keel/adapters/fake/simulator', () => ({ readActorHolds: () => state.holds }))

afterEach(() => {
    state.fake = false
    state.flags = {}
    state.holds = {}
})

function ask(actor?: string): Request {
    const query = actor === undefined ? '' : `?actor=${encodeURIComponent(actor)}`
    return new Request(`http://localhost/api/simulator/actors/held${query}`)
}

describe('GET /api/simulator/actors/held', () => {
    test('404s outside simulated mode', async () => {
        const { GET } = await import('./route')
        state.fake = false

        expect((await GET(ask('partner-desk'))).status).toBe(404)
    })

    test('answers false for an actor nothing holds', async () => {
        const { GET } = await import('./route')
        state.fake = true

        const response = await GET(ask('partner-desk'))

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ held: false })
    })

    test("answers true for the actor's own hold, and only for that actor", async () => {
        const { GET } = await import('./route')
        state.fake = true
        state.holds = { 'partner-desk': true }

        expect(await (await GET(ask('partner-desk'))).json()).toEqual({ held: true })
        expect(await (await GET(ask('bundle-analyzer'))).json()).toEqual({ held: false })
    })

    test('answers true for every actor while the world-wide actors-held flag is on', async () => {
        const { GET } = await import('./route')
        state.fake = true
        state.flags = { 'actors-held': true }

        expect(await (await GET(ask('partner-desk'))).json()).toEqual({ held: true })
        expect(await (await GET(ask('bundle-analyzer'))).json()).toEqual({ held: true })
    })

    test('a released hold (false) is not held', async () => {
        const { GET } = await import('./route')
        state.fake = true
        state.holds = { 'partner-desk': false }

        expect(await (await GET(ask('partner-desk'))).json()).toEqual({ held: false })
    })

    test('400s for an actor the registry lacks, or no actor at all', async () => {
        const { GET } = await import('./route')
        state.fake = true

        expect((await GET(ask('no-such-actor'))).status).toBe(400)
        expect((await GET(ask())).status).toBe(400)
    })
})
