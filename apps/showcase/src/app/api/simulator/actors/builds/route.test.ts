import { afterEach, describe, expect, test, vi } from 'vitest'

// Mirror the Jobs-route test shape: one mutable hoisted control surface exercises BOTH the
// production-containment 404 (simulated mode off) and the simulated-mode body. The adapter is mocked so the
// test never spins up pglite (that integration is proven in packages/keel/src/adapters/fake/jobs.test.ts).
const state = vi.hoisted(() => ({ fake: false, builds: [] as unknown[] }))

vi.mock('keel/adapters/index', () => ({
    get isSimulated() {
        return state.fake
    },
}))
vi.mock('keel/adapters/fake/jobs', () => ({
    listPendingBuilds: async () => state.builds,
}))

afterEach(() => {
    state.fake = false
    state.builds = []
})

describe('GET /api/simulator/actors/builds', () => {
    test('404s outside simulated mode', async () => {
        const { GET } = await import('./route')
        state.fake = false

        expect((await GET()).status).toBe(404)
    })

    test('returns the pending builds in simulated mode', async () => {
        const { GET } = await import('./route')
        state.fake = true
        state.builds = [{ jobId: 'job-1', tenantSlug: 'pinebrook', orgSlug: 'support-crew', status: 'queued' }]

        const response = await GET()

        expect(response.status).toBe(200)
        const body = (await response.json()) as { builds: { jobId: string }[] }
        expect(body.builds).toHaveLength(1)
        expect(body.builds[0]!.jobId).toBe('job-1')
    })
})
