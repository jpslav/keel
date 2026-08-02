import { beforeEach, describe, expect, test, vi } from 'vitest'
import { InvalidTransitionError } from 'keel/core/state-machine'
import { AuthRequiredError } from 'keel/ports/errors'
import type { ServiceIdentity } from 'keel/service-auth/verify'
import { POST } from './route'

const h = vi.hoisted(() => ({ verify: vi.fn(), jobForOrg: vi.fn(), record: vi.fn() }))
vi.mock('keel/adapters/index', () => ({ db: {} }))
vi.mock('keel/service-auth/verify', () => ({ verifyServiceCaller: h.verify }))
vi.mock('keel/db/jobs', () => ({ jobForOrg: h.jobForOrg, recordJobStatus: h.record }))

const identity: ServiceIdentity = {
    kind: 'org-service',
    tenantId: 't1',
    tenantSlug: 'northwind',
    orgId: 'o1',
    orgSlug: 'frontline',
}

function post(body: unknown, id = 'job-1'): Promise<Response> {
    const request = new Request(`http://localhost/api/service/jobs/${id}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    })
    return POST(request, { params: Promise.resolve({ id }) })
}

beforeEach(() => {
    h.verify.mockReset()
    h.jobForOrg.mockReset()
    h.record.mockReset()
    h.verify.mockResolvedValue(identity)
})

describe('POST /api/service/jobs/[id]/status', () => {
    test('401 when the token does not verify', async () => {
        h.verify.mockRejectedValue(new AuthRequiredError())

        const response = await post({ status: 'completed' })

        expect(response.status).toBe(401)
        expect(h.jobForOrg).not.toHaveBeenCalled()
    })

    test('400 on a missing / non-status / queued status', async () => {
        expect((await post({})).status).toBe(400)
        expect((await post({ status: 'not-a-status' })).status).toBe(400)
        expect((await post({ status: 'queued' })).status).toBe(400)
        expect(h.jobForOrg).not.toHaveBeenCalled()
    })

    test('400 when an optional field is the wrong type', async () => {
        const response = await post({ status: 'completed', resultKey: 42 })
        expect(response.status).toBe(400)
    })

    test("400 when resultKey escapes the caller's ORG namespace", async () => {
        // a planted foreign key would later be signed verbatim by GET /api/jobs — cross-tenant,
        // same-tenant-foreign-org, and off-namespace keys must all die here
        expect((await post({ status: 'completed', resultKey: 'exports/other-tenant/o1/j.csv' })).status).toBe(400)
        expect((await post({ status: 'completed', resultKey: 'exports/t1/other-org/j.csv' })).status).toBe(400)
        expect((await post({ status: 'completed', resultKey: 'exports/t1/j.csv' })).status).toBe(400)
        expect((await post({ status: 'completed', resultKey: 'secrets/anything' })).status).toBe(400)
        expect(h.record).not.toHaveBeenCalled()

        h.jobForOrg.mockResolvedValue({ id: 'job-1', status: 'running' })
        const ok = await post({ status: 'completed', resultKey: 'exports/t1/o1/job-1.csv' })
        expect(ok.status).toBe(200)
    })

    test("404 when the job is absent or another org's", async () => {
        h.jobForOrg.mockResolvedValue(null)

        const response = await post({ status: 'completed' })

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ error: 'not found' })
        expect(h.record).not.toHaveBeenCalled()
    })

    test('409 with from/to on an illegal transition', async () => {
        h.jobForOrg.mockResolvedValue({ id: 'job-1', status: 'completed' })
        h.record.mockRejectedValue(new InvalidTransitionError('completed', 'failed'))

        const response = await post({ status: 'failed' })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({ error: 'invalid-transition', from: 'completed', to: 'failed' })
    })

    test('200 records the transition with its optional fields', async () => {
        h.jobForOrg.mockResolvedValue({ id: 'job-1', status: 'running' })
        h.record.mockResolvedValue(undefined)

        const response = await post({ status: 'completed', resultKey: 'exports/t1/o1/x.csv', message: 'done' })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(h.record).toHaveBeenCalledWith({}, 't1', 'job-1', 'completed', {
            resultKey: 'exports/t1/o1/x.csv',
            error: undefined,
            message: 'done',
        })
    })
})
