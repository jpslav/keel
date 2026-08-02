import { afterEach, describe, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({ fake: false }))
vi.mock('keel/adapters/index', () => ({
    get isSimulated() {
        return state.fake
    },
}))
vi.mock('keel/adapters/fake/service-auth', () => ({ devWebhookSecret: () => 'secret-xyz' }))

const get = () => import('./route').then(({ GET }) => GET())

afterEach(() => {
    state.fake = false
})

describe('GET /api/simulator/webhook-secret', () => {
    test('404s outside simulated mode', async () => {
        state.fake = false
        expect((await get()).status).toBe(404)
    })

    test('returns the dev webhook secret in simulated mode', async () => {
        state.fake = true

        const response = await get()

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ secret: 'secret-xyz' })
    })
})
