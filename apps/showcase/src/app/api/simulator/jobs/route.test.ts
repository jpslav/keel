import { afterEach, describe, expect, test, vi } from 'vitest'

// A mutable, hoisted control surface so one file can exercise BOTH the production-containment 404
// (simulated mode off) and the simulated-mode shape — the fake world view is mocked so the test never has to
// spin up pglite (that integration is proven in packages/keel/src/adapters/fake/jobs.test.ts).
const state = vi.hoisted(() => ({
    fake: false,
    jobs: [] as unknown[],
    flags: {} as Record<string, boolean>,
}))

vi.mock('keel/adapters/index', () => ({
    get isSimulated() {
        return state.fake
    },
}))
vi.mock('keel/adapters/fake/jobs', () => ({
    JOBS_HELD_FLAG: 'jobs-held',
    listWorldJobs: async () => state.jobs,
}))
vi.mock('keel/adapters/fake/analytics', () => ({
    readFlags: () => state.flags,
}))

afterEach(() => {
    state.fake = false
    state.jobs = []
    state.flags = {}
})

describe('GET /api/simulator/jobs', () => {
    test('404s outside simulated mode', async () => {
        const { GET } = await import('./route')
        state.fake = false

        const response = await GET()

        expect(response.status).toBe(404)
    })

    test('returns the world jobs and the held flag in simulated mode', async () => {
        const { GET } = await import('./route')
        state.fake = true
        state.jobs = [{ id: 'job-1', kind: 'export-tickets', status: 'completed', tenantSlug: 'acme' }]
        state.flags = { 'jobs-held': true }

        const response = await GET()

        expect(response.status).toBe(200)
        const body = (await response.json()) as { jobs: { id: string }[]; held: boolean }
        expect(body.held).toBe(true)
        expect(body.jobs).toHaveLength(1)
        expect(body.jobs[0]!.id).toBe('job-1')
    })

    test('reports held=false when the flag is unset', async () => {
        const { GET } = await import('./route')
        state.fake = true

        const body = (await (await GET()).json()) as { held: boolean }

        expect(body.held).toBe(false)
    })
})
