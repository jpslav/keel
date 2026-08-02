import { beforeEach, describe, expect, test, vi } from 'vitest'
import { InvalidTransitionError } from 'keel/core/state-machine'
import type { AuthUser } from 'keel/ports/auth'
import { POST } from './route'

// Real authorize runs; only adapters + data modules are faked. Marisol acts in frontline (requester).
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
        id: 'user-marisol',
        name: 'Marisol Vega',
        email: 'marisol.vega@example.test',
        role: 'member',
        locale: 'es',
        tenantSlug: 'northwind',
        orgSlug: 'frontline',
        restricted: false,
        ...overrides,
    }
}

const ORG_IDS: Record<string, string> = { frontline: 'org-frontline', platform: 'org-platform' }
// An escalation frontline -> platform: the active org (frontline) is the requester side and may withdraw.
const REQUEST = { id: 'req-1', status: 'open', requesterOrgId: 'org-frontline', responderOrgId: 'org-platform' }

function post(id = 'req-1'): Promise<Response> {
    return POST(new Request(`http://localhost/api/escalations/${id}/cancel`, { method: 'POST' }), {
        params: Promise.resolve({ id }),
    })
}

beforeEach(() => {
    for (const fn of Object.values(h)) fn.mockReset()
    h.requireUser.mockResolvedValue(user())
    h.tenantIdForSlug.mockResolvedValue('tenant-northwind')
    h.orgIdForSlug.mockImplementation(async (_db: unknown, _tenantId: string, slug: string) => ORG_IDS[slug] ?? null)
    h.escalationForActiveOrg.mockResolvedValue(REQUEST)
    h.transitionEscalation.mockResolvedValue(undefined)
})

describe('POST /api/escalations/[id]/cancel', () => {
    test('200 withdraws the escalation as a member of the requester side (soft cancel)', async () => {
        const response = await post()

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ id: 'req-1', status: 'cancelled' })
        expect(h.transitionEscalation).toHaveBeenCalledWith({}, 'tenant-northwind', 'req-1', 'cancelled', {
            byUserId: 'user-marisol',
        })
    })

    test('403 when a restricted member tries to withdraw', async () => {
        h.requireUser.mockResolvedValue(user({ role: 'restricted', restricted: true }))

        const response = await post()

        expect(response.status).toBe(403)
        expect(h.transitionEscalation).not.toHaveBeenCalled()
    })

    test("404 when the active org is not a party to the escalation (or it's absent)", async () => {
        h.escalationForActiveOrg.mockResolvedValue(null)

        const response = await post()

        expect(response.status).toBe(404)
        expect(h.transitionEscalation).not.toHaveBeenCalled()
    })

    test('409 with from/to when the escalation was already decided', async () => {
        h.transitionEscalation.mockRejectedValue(new InvalidTransitionError('accepted', 'cancelled'))

        const response = await post()

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({ error: 'invalid-transition', from: 'accepted', to: 'cancelled' })
    })
})
