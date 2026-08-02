import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AuthUser } from 'keel/ports/auth'
import { POST } from './route'

// Real authorize (pure abilities) runs — only the adapters and data modules are faked.
const h = vi.hoisted(() => ({
    requireUser: vi.fn(),
    tenantIdForSlug: vi.fn(),
    orgIdForSlug: vi.fn(),
    attachmentForOrg: vi.fn(),
    confirmAttachment: vi.fn(),
    get: vi.fn(),
    recordAuditEvent: vi.fn(),
}))
vi.mock('keel/adapters/index', () => ({ auth: { requireUser: h.requireUser }, db: {}, storage: { get: h.get } }))
vi.mock('keel/db/tenant-lookup', () => ({ tenantIdForSlug: h.tenantIdForSlug }))
vi.mock('keel/db/org-lookup', () => ({ orgIdForSlug: h.orgIdForSlug }))
vi.mock('keel/db/audit', () => ({ recordAuditEvent: h.recordAuditEvent }))
vi.mock('@/domain/db/attachments', () => ({
    attachmentForOrg: h.attachmentForOrg,
    confirmAttachment: h.confirmAttachment,
}))

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

function confirm(id = 'art-1'): Promise<Response> {
    return POST(new Request(`http://localhost/api/attachments/${id}/confirm`, { method: 'POST' }), {
        params: Promise.resolve({ id }),
    })
}

beforeEach(() => {
    for (const fn of Object.values(h)) fn.mockReset()
    h.requireUser.mockResolvedValue(user())
    h.tenantIdForSlug.mockResolvedValue('tenant-northwind')
    h.orgIdForSlug.mockResolvedValue('org-frontline')
    h.attachmentForOrg.mockResolvedValue({
        id: 'art-1',
        storageKey: 'attachments/tenant-northwind/uuid/a.txt',
        status: 'pending',
    })
    h.get.mockResolvedValue({ body: new Uint8Array([1, 2, 3, 4]), contentType: 'text/plain' })
    h.confirmAttachment.mockResolvedValue(1)
})

describe('POST /api/attachments/[id]/confirm', () => {
    test("200 records the object's true size and finalizes the row", async () => {
        const response = await confirm()
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ attachmentId: 'art-1' })
        // Size comes from the STORED bytes (4), never the client.
        expect(h.confirmAttachment).toHaveBeenCalledWith({}, 'tenant-northwind', 'org-frontline', 'art-1', 4)
        expect(h.recordAuditEvent).toHaveBeenCalledTimes(1)
    })

    test('200-idempotent on a re-confirm of a ready attachment, with NO second audit event', async () => {
        h.confirmAttachment.mockResolvedValue(0)
        const response = await confirm()
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ attachmentId: 'art-1', idempotent: true })
        // The audit trail says only what actually happened — nothing did.
        expect(h.recordAuditEvent).not.toHaveBeenCalled()
    })

    test("404 when the id is not one of the active org's attachments (indistinguishable from missing)", async () => {
        h.attachmentForOrg.mockResolvedValue(null)
        expect((await confirm('ghost')).status).toBe(404)
        expect(h.confirmAttachment).not.toHaveBeenCalled()
    })

    test('400 when the upload never landed in storage (no dead download links)', async () => {
        h.get.mockResolvedValue(null)
        expect((await confirm()).status).toBe(400)
        expect(h.confirmAttachment).not.toHaveBeenCalled()
    })

    test('403 when a restricted member tries to finalize an upload', async () => {
        h.requireUser.mockResolvedValue(user({ role: 'restricted', restricted: true }))
        expect((await confirm()).status).toBe(403)
        expect(h.confirmAttachment).not.toHaveBeenCalled()
    })

    test('401 when no one is signed in', async () => {
        const { AuthRequiredError } = await import('keel/ports/errors')
        h.requireUser.mockRejectedValue(new AuthRequiredError())
        expect((await confirm()).status).toBe(401)
    })
})
