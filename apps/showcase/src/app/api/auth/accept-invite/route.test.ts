import { describe, expect, test, vi } from 'vitest'

// Production containment (design invariant): 404s outside simulated mode, first line, same pattern as
// /api/auth/dev-signin and every /api/simulator/* route.
vi.mock('keel/adapters/index', () => ({ isSimulated: false }))

describe('POST /api/auth/accept-invite', () => {
    test('404s outside simulated mode', async () => {
        const { POST } = await import('./route')

        const response = await POST(
            new Request('http://localhost/api/auth/accept-invite', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ inviteId: 'some-invite-id', name: 'Bob' }),
            }),
        )

        expect(response.status).toBe(404)
    })
})
