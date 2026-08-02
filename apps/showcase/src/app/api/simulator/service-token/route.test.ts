import { afterEach, describe, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({ fake: false, mint: vi.fn() }))
vi.mock('keel/adapters/index', () => ({
    get isSimulated() {
        return state.fake
    },
}))
vi.mock('keel/adapters/fake/service-auth', () => ({ mintServiceToken: state.mint }))

function post(body: unknown): Promise<Response> {
    const request = new Request('http://localhost/api/simulator/service-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    })
    return import('./route').then(({ POST }) => POST(request))
}

afterEach(() => {
    state.fake = false
    state.mint.mockReset()
})

describe('POST /api/simulator/service-token', () => {
    test('404s outside simulated mode', async () => {
        state.fake = false
        expect((await post({ orgSlug: 'frontline' })).status).toBe(404)
        expect(state.mint).not.toHaveBeenCalled()
    })

    test('400 when orgSlug is missing', async () => {
        state.fake = true
        expect((await post({})).status).toBe(400)
        expect(state.mint).not.toHaveBeenCalled()
    })

    test('mints a token in simulated mode', async () => {
        state.fake = true
        const minted = {
            token: 'jwt',
            expiresAt: 'iso',
            orgSlug: 'frontline',
            tenantSlug: 'northwind',
            orgId: 'o',
            tenantId: 't',
        }
        state.mint.mockResolvedValue(minted)

        const response = await post({ orgSlug: 'frontline' })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual(minted)
        expect(state.mint).toHaveBeenCalledWith('frontline', undefined)
    })
})
