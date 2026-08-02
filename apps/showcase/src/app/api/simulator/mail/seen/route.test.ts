import { describe, expect, test, vi } from 'vitest'

// Same production-containment gate as the rest of /api/simulator/*.
vi.mock('keel/adapters/index', () => ({ isSimulated: false }))

describe('POST /api/simulator/mail/seen', () => {
    test('404s outside simulated mode', async () => {
        const { POST } = await import('./route')

        const response = await POST(
            new Request('http://localhost/api/simulator/mail/seen', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ person: 'person:person-admin' }),
            }),
        )

        expect(response.status).toBe(404)
    })
})
