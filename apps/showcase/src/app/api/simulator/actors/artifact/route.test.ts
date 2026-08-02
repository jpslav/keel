import { afterEach, describe, expect, test, vi } from 'vitest'
import { NotFoundError } from 'keel/ports/errors'

const state = vi.hoisted(() => ({ fake: false, produce: vi.fn() }))

vi.mock('keel/adapters/index', () => ({
    get isSimulated() {
        return state.fake
    },
}))
vi.mock('keel/adapters/fake/jobs', () => ({ produceJobArtifact: state.produce }))

function post(body: unknown): Promise<Response> {
    const request = new Request('http://localhost/api/simulator/actors/artifact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    })
    return import('./route').then(({ POST }) => POST(request))
}

afterEach(() => {
    state.fake = false
    state.produce.mockReset()
})

describe('POST /api/simulator/actors/artifact', () => {
    test('404s outside simulated mode', async () => {
        state.fake = false
        expect((await post({ tenantId: 't', jobId: 'j' })).status).toBe(404)
        expect(state.produce).not.toHaveBeenCalled()
    })

    test('400 when tenantId or jobId is missing', async () => {
        state.fake = true
        expect((await post({ tenantId: 't' })).status).toBe(400)
        expect((await post({ jobId: 'j' })).status).toBe(400)
        expect(state.produce).not.toHaveBeenCalled()
    })

    test('returns the produced resultKey in simulated mode', async () => {
        state.fake = true
        state.produce.mockResolvedValue({ resultKey: 'exports/t/j.csv' })

        const response = await post({ tenantId: 't', jobId: 'j' })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ resultKey: 'exports/t/j.csv' })
        expect(state.produce).toHaveBeenCalledWith('t', 'j')
    })

    test('passes a handler error through as { error }', async () => {
        state.fake = true
        state.produce.mockResolvedValue({ error: 'unknown job kind: nope' })

        const response = await post({ tenantId: 't', jobId: 'j' })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ error: 'unknown job kind: nope' })
    })

    test('an unknown job becomes a 404 via NotFoundError', async () => {
        state.fake = true
        state.produce.mockRejectedValue(new NotFoundError('unknown job: j'))

        expect((await post({ tenantId: 't', jobId: 'j' })).status).toBe(404)
    })
})
