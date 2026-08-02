import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AuthUser } from 'keel/ports/auth'
import { GET, POST } from './route'

// Real authorize (pure abilities) runs — only the adapters and data modules are faked. Low-entropy
// fixture ids/slugs (gitleaks): no hex, no UUIDs.
const h = vi.hoisted(() => ({
    requireUser: vi.fn(),
    listMembers: vi.fn(),
    tenantIdForSlug: vi.fn(),
    orgIdForSlug: vi.fn(),
    orgForId: vi.fn(),
    listOrgsInTenant: vi.fn(),
    createEscalation: vi.fn(),
    listEscalations: vi.fn(),
    recordAuditEvent: vi.fn(),
    enqueueWebhookEvent: vi.fn(),
    notifyAdmins: vi.fn(),
    makeNotifyDeps: vi.fn(),
}))
vi.mock('keel/adapters/index', () => ({
    auth: { requireUser: h.requireUser, listMembers: h.listMembers },
    db: {},
}))
vi.mock('keel/db/tenant-lookup', () => ({ tenantIdForSlug: h.tenantIdForSlug }))
vi.mock('keel/db/org-lookup', () => ({
    orgIdForSlug: h.orgIdForSlug,
    orgForId: h.orgForId,
    listOrgsInTenant: h.listOrgsInTenant,
}))
vi.mock('keel/db/audit', () => ({ recordAuditEvent: h.recordAuditEvent }))
vi.mock('@/domain/db/escalations', () => ({
    createEscalation: h.createEscalation,
    listEscalations: h.listEscalations,
}))
vi.mock('keel/db/webhooks', () => ({ enqueueWebhookEvent: h.enqueueWebhookEvent }))
// The notification fan-out is mocked away — the route test isolates the create path, not the
// notify seam (mirrors the mocked enqueueWebhookEvent beside it).
vi.mock('keel/server-lib/notify', () => ({ notifyAdmins: h.notifyAdmins }))
vi.mock('keel/server-lib/notify-deps', () => ({ makeNotifyDeps: h.makeNotifyDeps }))

function user(overrides: Partial<AuthUser> = {}): AuthUser {
    return {
        id: 'user-ada',
        name: 'Dana Okoye',
        email: 'dana.okoye@example.test',
        role: 'member',
        locale: 'en',
        tenantSlug: 'northwind',
        orgSlug: 'frontline',
        restricted: false,
        ...overrides,
    }
}

// frontline is the requester side, platform the responder side.
const ORG_IDS: Record<string, string> = { frontline: 'org-frontline', platform: 'org-platform' }

function post(body: unknown): Promise<Response> {
    return POST(
        new Request('http://localhost/api/escalations', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        }),
    )
}

beforeEach(() => {
    for (const fn of Object.values(h)) fn.mockReset()
    h.requireUser.mockResolvedValue(user())
    h.listMembers.mockResolvedValue([])
    h.tenantIdForSlug.mockResolvedValue('tenant-northwind')
    h.orgIdForSlug.mockImplementation(async (_db: unknown, _tenantId: string, slug: string) => ORG_IDS[slug] ?? null)
    h.orgForId.mockResolvedValue({ slug: 'frontline', name: 'Frontline Desk' })
    h.createEscalation.mockResolvedValue({ id: 'req-1' })
    h.notifyAdmins.mockResolvedValue(0)
    h.makeNotifyDeps.mockResolvedValue({})
})

describe('POST /api/escalations (create)', () => {
    test('201 raises an escalation from the active org to another org', async () => {
        const response = await post({ responderOrgSlug: 'platform', subject: 'collab', body: 'lets work together' })

        expect(response.status).toBe(201)
        expect(await response.json()).toEqual({ id: 'req-1' })
        expect(h.createEscalation).toHaveBeenCalledWith(
            {},
            {
                tenantId: 'tenant-northwind',
                requesterOrgId: 'org-frontline',
                responderOrgId: 'org-platform',
                createdByUserId: 'user-ada',
                subject: 'collab',
                body: 'lets work together',
            },
        )
    })

    test('400 on a missing subject or body', async () => {
        expect((await post({ responderOrgSlug: 'platform', subject: '', body: 'x' })).status).toBe(400)
        expect((await post({ responderOrgSlug: 'platform', subject: 'x', body: '  ' })).status).toBe(400)
        expect((await post({ subject: 'x', body: 'y' })).status).toBe(400)
        expect(h.createEscalation).not.toHaveBeenCalled()
    })

    test('400 when the escalation targets the active org itself (self-escalation)', async () => {
        expect((await post({ responderOrgSlug: 'frontline', subject: 'x', body: 'y' })).status).toBe(400)
        expect(h.createEscalation).not.toHaveBeenCalled()
    })

    test('403 when a restricted member tries to raise an escalation', async () => {
        h.requireUser.mockResolvedValue(user({ role: 'restricted', restricted: true }))

        const response = await post({ responderOrgSlug: 'platform', subject: 'x', body: 'y' })

        expect(response.status).toBe(403)
        expect(h.createEscalation).not.toHaveBeenCalled()
    })

    test('404 when the responder org slug is unknown', async () => {
        const response = await post({ responderOrgSlug: 'ghost', subject: 'x', body: 'y' })

        expect(response.status).toBe(404)
        expect(h.createEscalation).not.toHaveBeenCalled()
    })
})

describe('GET /api/escalations (list + targets)', () => {
    test('returns both sides plus the tenant orgs minus the active one as targets', async () => {
        h.listEscalations.mockResolvedValue({ sent: [{ id: 'req-1' }], received: [] })
        h.listOrgsInTenant.mockResolvedValue([
            { id: 'org-frontline', slug: 'frontline', name: 'Frontline Desk' },
            { id: 'org-platform', slug: 'platform', name: 'Platform Team' },
        ])

        const response = await GET()

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            sent: [{ id: 'req-1' }],
            received: [],
            // the active org (frontline) is stripped from the target list
            targets: [{ slug: 'platform', name: 'Platform Team' }],
        })
    })
})
