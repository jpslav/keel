import { beforeEach, describe, expect, test, vi } from 'vitest'
import { InvalidTransitionError } from 'keel/core/state-machine'
import { AuthRequiredError, NotFoundError } from 'keel/ports/errors'
import { POST } from './route'

const h = vi.hoisted(() => ({ verify: vi.fn(), record: vi.fn(), notifyJobTerminal: vi.fn(), makeNotifyDeps: vi.fn() }))
vi.mock('keel/adapters/index', () => ({ db: {}, auth: {} }))
vi.mock('keel/service-auth/webhook', () => ({ verifyWebhookCaller: h.verify }))
vi.mock('keel/db/jobs', () => ({ recordWebhookCompletion: h.record }))
// The notification fan-out is mocked away — the route test isolates the completion path, not
// the notify seam (mirrors how the escalation route test mocks enqueueWebhookEvent).
vi.mock('keel/server-lib/notify', () => ({ notifyJobTerminal: h.notifyJobTerminal }))
vi.mock('keel/server-lib/notify-deps', () => ({ makeNotifyDeps: h.makeNotifyDeps }))

function post(body: unknown): Promise<Response> {
    const request = new Request('http://localhost/api/webhooks/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    })
    // No dynamic segment; Next passes an (unused) empty params context.
    return POST(request, { params: Promise.resolve<Record<string, string>>({}) })
}

const valid = { jobId: 'job-1', tenantId: 't1', status: 'completed' as const }

beforeEach(() => {
    h.verify.mockReset()
    h.record.mockReset()
    h.notifyJobTerminal.mockReset()
    h.makeNotifyDeps.mockReset()
    h.verify.mockReturnValue(undefined)
    h.notifyJobTerminal.mockResolvedValue(undefined)
    h.makeNotifyDeps.mockResolvedValue({})
})

describe('POST /api/webhooks/jobs', () => {
    test('401 when the shared secret is wrong', async () => {
        h.verify.mockImplementation(() => {
            throw new AuthRequiredError()
        })

        const response = await post(valid)

        expect(response.status).toBe(401)
        expect(h.record).not.toHaveBeenCalled()
    })

    test('400 on a malformed payload', async () => {
        expect((await post({ tenantId: 't1', status: 'completed' })).status).toBe(400) // no jobId
        expect((await post({ jobId: 'j', tenantId: 't1', status: 'weird' })).status).toBe(400) // bad status
        expect((await post({ jobId: 'j', tenantId: 't1', status: 'completed', resultKey: 5 })).status).toBe(400)
        expect(h.record).not.toHaveBeenCalled()
    })

    test("400 when resultKey escapes the named tenant's namespace", async () => {
        const planted = { ...valid, resultKey: 'exports/other-tenant/j.csv' }
        expect((await post(planted)).status).toBe(400)
        expect(h.record).not.toHaveBeenCalled()
    })

    test('200 { idempotent: false } when the completion is newly applied', async () => {
        h.record.mockResolvedValue('applied')

        const response = await post({ ...valid, resultKey: 'exports/t1/x.csv' })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true, idempotent: false })
        expect(h.record).toHaveBeenCalledWith(
            {},
            { tenantId: 't1', jobId: 'job-1', status: 'completed', resultKey: 'exports/t1/x.csv', error: undefined },
        )
    })

    test('200 { idempotent: true } on a redelivery', async () => {
        h.record.mockResolvedValue('idempotent')

        const response = await post(valid)

        expect(await response.json()).toEqual({ ok: true, idempotent: true })
    })

    test('404 for an unknown job', async () => {
        h.record.mockRejectedValue(new NotFoundError())

        expect((await post(valid)).status).toBe(404)
    })

    test('409 with from/to on an illegal transition', async () => {
        h.record.mockRejectedValue(new InvalidTransitionError('completed', 'failed'))

        const response = await post({ ...valid, status: 'failed' })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({ error: 'invalid-transition', from: 'completed', to: 'failed' })
    })
})
