import { afterEach, describe, expect, test, vi } from 'vitest'

// Same mutable-hoisted trick as the jobs GET test: one file covers the production-containment 404
// (simulated mode off) and the simulated-mode shape, with the world runner mocked so no pglite spins up.
const state = vi.hoisted(() => ({ fake: false, ran: 0 }))

vi.mock('keel/adapters/index', () => ({
    get isSimulated() {
        return state.fake
    },
}))
vi.mock('keel/adapters/fake/jobs', () => ({
    runPendingJobs: async () => state.ran,
}))

afterEach(() => {
    state.fake = false
    state.ran = 0
})

describe('POST /api/simulator/jobs/run-pending', () => {
    test('404s outside simulated mode', async () => {
        const { POST } = await import('./route')
        state.fake = false

        const response = await POST()

        expect(response.status).toBe(404)
    })

    test('reports how many jobs ran in simulated mode', async () => {
        const { POST } = await import('./route')
        state.fake = true
        state.ran = 3

        const response = await POST()

        expect(response.status).toBe(200)
        const body = (await response.json()) as { ran: number }
        expect(body.ran).toBe(3)
    })
})
