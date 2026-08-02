import { describe, expect, test, vi } from 'vitest'

// Production containment (design invariant): every /api/simulator/* route 404s outside simulated mode,
// first line, no role gate involved.
vi.mock('keel/adapters/index', () => ({ isSimulated: false }))

describe('POST /api/simulator/snapshots/restore', () => {
    test('404s outside simulated mode', async () => {
        const { POST } = await import('./route')

        const response = await POST(
            new Request('http://localhost/api/simulator/snapshots/restore', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: 'checkpoint' }),
            }),
        )

        expect(response.status).toBe(404)
    })
})
