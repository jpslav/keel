import { describe, expect, test, vi } from 'vitest'

// Production containment (design invariant): every /api/simulator/* route 404s outside simulated mode,
// first line, no role gate involved.
vi.mock('keel/adapters/index', () => ({ isSimulated: false, auth: { getCurrentUser: async () => null } }))

describe('GET /api/simulator/summary', () => {
    test('404s outside simulated mode', async () => {
        const { GET } = await import('./route')

        const response = await GET()

        expect(response.status).toBe(404)
    })
})
