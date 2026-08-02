import { describe, expect, test, vi } from 'vitest'

// Production containment (design invariant): every /api/simulator/* route 404s outside simulated mode,
// first line, no role gate involved.
vi.mock('keel/adapters/index', () => ({ isSimulated: false }))

describe('GET /api/simulator/snapshots', () => {
    test('404s outside simulated mode', async () => {
        const { GET } = await import('./route')

        const response = await GET()

        expect(response.status).toBe(404)
    })
})

describe('POST /api/simulator/snapshots', () => {
    test('404s outside simulated mode', async () => {
        const { POST } = await import('./route')

        const response = await POST(
            new Request('http://localhost/api/simulator/snapshots', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: 'checkpoint' }),
            }),
        )

        expect(response.status).toBe(404)
    })
})
