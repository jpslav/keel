import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AuthRequiredError } from 'keel/ports/errors'
import type { ServiceIdentity } from 'keel/service-auth/verify'
import { GET } from './route'

// Unit-level: the real verify + db are mocked so the route's own logic (auth gate, status guard,
// response shape) is exercised without crypto or pglite. Mocking '@/adapters' also dodges server-only.
const h = vi.hoisted(() => ({ verify: vi.fn(), list: vi.fn() }))
vi.mock('keel/adapters/index', () => ({ db: {} }))
vi.mock('keel/service-auth/verify', () => ({ verifyServiceCaller: h.verify }))
vi.mock('keel/db/jobs', () => ({ listServiceJobs: h.list }))

const identity: ServiceIdentity = {
    kind: 'org-service',
    tenantId: 't1',
    tenantSlug: 'northwind',
    orgId: 'o1',
    orgSlug: 'frontline',
}

// This route takes no dynamic segment; Next passes an (unused) empty params context.
const get = (url = 'http://localhost/api/service/jobs') =>
    GET(new Request(url), { params: Promise.resolve<Record<string, string>>({}) })

beforeEach(() => {
    h.verify.mockReset()
    h.list.mockReset()
})

describe('GET /api/service/jobs', () => {
    test('401 when the token does not verify', async () => {
        h.verify.mockRejectedValue(new AuthRequiredError())

        const response = await get()

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({ error: 'unauthorized' })
        expect(h.list).not.toHaveBeenCalled()
    })

    test('200 returns the jobs and scopes the query to the verified org', async () => {
        h.verify.mockResolvedValue(identity)
        h.list.mockResolvedValue([{ id: 'j1', kind: 'export-tickets', status: 'completed' }])

        const response = await get()

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ jobs: [{ id: 'j1', kind: 'export-tickets', status: 'completed' }] })
        expect(h.list).toHaveBeenCalledWith({}, 't1', 'o1', { status: undefined })
    })

    test('a valid ?status filter is passed through', async () => {
        h.verify.mockResolvedValue(identity)
        h.list.mockResolvedValue([])

        await get('http://localhost/api/service/jobs?status=running')

        expect(h.list).toHaveBeenCalledWith({}, 't1', 'o1', { status: 'running' })
    })

    test('400 on an unknown ?status value, without touching the db', async () => {
        h.verify.mockResolvedValue(identity)

        const response = await get('http://localhost/api/service/jobs?status=bogus')

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({ error: 'invalid-payload' })
        expect(h.list).not.toHaveBeenCalled()
    })
})
