import { describe, expect, test, vi } from 'vitest'

// Production containment (design invariant): every /api/simulator/* route 404s outside simulated mode,
// first line, no role gate involved.
vi.mock('keel/adapters/index', () => ({ isSimulated: false }))

describe('GET /api/simulator/mail', () => {
    test('404s outside simulated mode', async () => {
        const { GET } = await import('./route')

        const response = await GET(new Request('http://localhost/api/simulator/mail?all=1'))

        expect(response.status).toBe(404)
    })
})
