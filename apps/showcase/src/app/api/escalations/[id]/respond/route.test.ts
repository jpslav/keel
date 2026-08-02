import { beforeEach, describe, expect, test, vi } from 'vitest'
import { InvalidTransitionError } from 'keel/core/state-machine'
import type { AuthUser } from 'keel/ports/auth'
import { POST } from './route'

// Real authorize runs; only adapters + data modules are faked. Sam acts in platform (the responder).
const h = vi.hoisted(() => ({
    requireUser: vi.fn(),
    tenantIdForSlug: vi.fn(),
    orgIdForSlug: vi.fn(),
    escalationForActiveOrg: vi.fn(),
    transitionEscalation: vi.fn(),
    recordAuditEvent: vi.fn(),
    enqueueWebhookEvent: vi.fn(),
}))
vi.mock('keel/adapters/index', () => ({ auth: { requireUser: h.requireUser }, db: {} }))
vi.mock('keel/db/tenant-lookup', () => ({ tenantIdForSlug: h.tenantIdForSlug }))
vi.mock('keel/db/org-lookup', () => ({ orgIdForSlug: h.orgIdForSlug }))
vi.mock('keel/db/audit', () => ({ recordAuditEvent: h.recordAuditEvent }))
vi.mock('@/domain/db/escalations', () => ({
    escalationForActiveOrg: h.escalationForActiveOrg,
    transitionEscalation: h.transitionEscalation,
}))
vi.mock('keel/db/webhooks', () => ({ enqueueWebhookEvent: h.enqueueWebhookEvent }))

function user(overrides: Partial<AuthUser> = {}): AuthUser {
    return {
        id: 'user-sam',
        name: 'Sam Rivera',
        email: 'sam.rivera@example.test',
        role: 'staff',
        locale: 'en',
        tenantSlug: 'northwind',
        orgSlug: 'platform',
        restricted: false,
        ...overrides,
    }
}

const ORG_IDS: Record<string, string> = { frontline: 'org-frontline', platform: 'org-platform' }
// An escalation frontline -> platform: the active org (platform) is the responder side.
const REQUEST = { id: 'req-1', status: 'open', requesterOrgId: 'org-frontline', responderOrgId: 'org-platform' }

function post(body: unknown, id = 'req-1'): Promise<Response> {
    return POST(
        new Request(`http://localhost/api/escalations/${id}/respond`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id }) },
    )
}

beforeEach(() => {
    for (const fn of Object.values(h)) fn.mockReset()
    h.requireUser.mockResolvedValue(user())
    h.tenantIdForSlug.mockResolvedValue('tenant-northwind')
    h.orgIdForSlug.mockImplementation(async (_db: unknown, _tenantId: string, slug: string) => ORG_IDS[slug] ?? null)
    h.escalationForActiveOrg.mockResolvedValue(REQUEST)
    h.transitionEscalation.mockResolvedValue(undefined)
})

describe('POST /api/escalations/[id]/respond', () => {
    test('200 accepts an escalation as an org manager on the responder side', async () => {
        const response = await post({ decision: 'accept' })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ id: 'req-1', status: 'accepted' })
        expect(h.transitionEscalation).toHaveBeenCalledWith({}, 'tenant-northwind', 'req-1', 'accepted', {
            byUserId: 'user-sam',
        })
    })

    test('200 rejects an escalation (decision reject)', async () => {
        const response = await post({ decision: 'reject' })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ id: 'req-1', status: 'rejected' })
    })

    test('400 on a missing / non-accept-reject decision', async () => {
        expect((await post({})).status).toBe(400)
        expect((await post({ decision: 'maybe' })).status).toBe(400)
        expect(h.transitionEscalation).not.toHaveBeenCalled()
    })

    test('403 when the responder-side actor is a plain member (respond needs a manager)', async () => {
        h.requireUser.mockResolvedValue(user({ role: 'member' }))

        const response = await post({ decision: 'accept' })

        expect(response.status).toBe(403)
        expect(h.transitionEscalation).not.toHaveBeenCalled()
    })

    test("404 when the active org is not a party to the escalation (or it's absent)", async () => {
        h.escalationForActiveOrg.mockResolvedValue(null)

        const response = await post({ decision: 'accept' })

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ error: 'not found' })
        expect(h.transitionEscalation).not.toHaveBeenCalled()
    })

    test('409 with from/to when the escalation was already decided', async () => {
        h.transitionEscalation.mockRejectedValue(new InvalidTransitionError('accepted', 'rejected'))

        const response = await post({ decision: 'reject' })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({ error: 'invalid-transition', from: 'accepted', to: 'rejected' })
    })
})
