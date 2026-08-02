import { beforeEach, describe, expect, test, vi } from 'vitest'
import { InvalidTransitionError } from 'keel/core/state-machine'
import type { AuthUser } from 'keel/ports/auth'
import { DELETE, PATCH } from './route'

// Real authorize (pure abilities) and the real ticket machine's status vocabulary run — only the
// adapters and data modules are faked. Low-entropy fixture ids/slugs (gitleaks): no hex, no UUIDs.
const h = vi.hoisted(() => ({
    requireUser: vi.fn(),
    listMembers: vi.fn(),
    tenantIdForSlug: vi.fn(),
    orgIdForSlug: vi.fn(),
    ticketForOrg: vi.fn(),
    updateTicket: vi.fn(),
    deleteTicket: vi.fn(),
    recordAuditEvent: vi.fn(),
    notifyMember: vi.fn(),
    makeNotifyDeps: vi.fn(),
}))
vi.mock('keel/adapters/index', () => ({
    auth: { requireUser: h.requireUser, listMembers: h.listMembers },
    db: {},
}))
vi.mock('keel/db/tenant-lookup', () => ({ tenantIdForSlug: h.tenantIdForSlug }))
vi.mock('keel/db/org-lookup', () => ({ orgIdForSlug: h.orgIdForSlug }))
vi.mock('keel/db/audit', () => ({ recordAuditEvent: h.recordAuditEvent }))
vi.mock('@/domain/db/tickets', () => ({
    ticketForOrg: h.ticketForOrg,
    updateTicket: h.updateTicket,
    deleteTicket: h.deleteTicket,
}))
// The notification fan-out is mocked away — this test isolates the edit path, not the notify seam.
vi.mock('keel/server-lib/notify', () => ({ notifyMember: h.notifyMember }))
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

const ORG_IDS: Record<string, string> = { frontline: 'org-frontline', platform: 'org-platform' }
const TICKET = { id: 'ticket-1', ref: 'NW-1041', subject: 'Blank labels', status: 'open', assigneeUserId: null }

function patch(body: unknown, id = 'ticket-1'): Promise<Response> {
    return PATCH(
        new Request(`http://localhost/api/tickets/${id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id }) },
    )
}

function del(id = 'ticket-1'): Promise<Response> {
    return DELETE(new Request(`http://localhost/api/tickets/${id}`, { method: 'DELETE' }), {
        params: Promise.resolve({ id }),
    })
}

beforeEach(() => {
    for (const fn of Object.values(h)) fn.mockReset()
    h.requireUser.mockResolvedValue(user())
    h.listMembers.mockResolvedValue([])
    h.tenantIdForSlug.mockResolvedValue('tenant-northwind')
    h.orgIdForSlug.mockImplementation(async (_db: unknown, _tenantId: string, slug: string) => ORG_IDS[slug] ?? null)
    h.ticketForOrg.mockResolvedValue(TICKET)
    h.updateTicket.mockResolvedValue({ ...TICKET, status: 'pending' })
    h.deleteTicket.mockResolvedValue(1)
    h.notifyMember.mockResolvedValue(true)
    h.makeNotifyDeps.mockResolvedValue({})
})

describe('PATCH /api/tickets/[id] — validation at the boundary', () => {
    test('400 on a status the machine has never heard of, before anything is resolved', async () => {
        const response = await patch({ status: 'closed' })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({ error: 'unknown-status' })
        expect(h.updateTicket).not.toHaveBeenCalled()
    })

    test('400 on an assignee that is neither a string nor null', async () => {
        expect((await patch({ assigneeUserId: 42 })).status).toBe(400)
        expect(h.updateTicket).not.toHaveBeenCalled()
    })

    test('400 when the body asks for nothing at all', async () => {
        const response = await patch({})

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({ error: 'nothing-to-change' })
        expect(h.updateTicket).not.toHaveBeenCalled()
    })
})

describe('PATCH /api/tickets/[id] — authorization and scoping', () => {
    test('404 for a ticket that is missing, or belongs to another team — the same answer for both', async () => {
        h.ticketForOrg.mockResolvedValue(null)

        const response = await patch({ status: 'pending' })

        expect(response.status).toBe(404)
        expect(h.updateTicket).not.toHaveBeenCalled()
    })

    test('403 when a restricted member tries to change one', async () => {
        h.requireUser.mockResolvedValue(user({ role: 'restricted', restricted: true }))

        const response = await patch({ status: 'pending' })

        expect(response.status).toBe(403)
        expect(h.updateTicket).not.toHaveBeenCalled()
        expect(h.recordAuditEvent).not.toHaveBeenCalled()
    })

    test('404 when the tenant or the active org cannot be resolved', async () => {
        h.tenantIdForSlug.mockResolvedValue(null)
        expect((await patch({ status: 'pending' })).status).toBe(404)
    })
})

describe('PATCH /api/tickets/[id] — the edit itself', () => {
    test('200 changes the status and audits it as an update', async () => {
        const response = await patch({ status: 'pending' })

        expect(response.status).toBe(200)
        expect(h.updateTicket).toHaveBeenCalledWith({}, 'tenant-northwind', 'org-frontline', 'ticket-1', {
            status: 'pending',
        })
        expect(h.recordAuditEvent).toHaveBeenCalledWith({}, expect.objectContaining({ action: 'ticket.updated' }))
        expect(h.notifyMember).not.toHaveBeenCalled()
    })

    test('409 when the machine forbids the hop, and nothing is audited', async () => {
        h.updateTicket.mockRejectedValue(new InvalidTransitionError('open', 'open'))

        const response = await patch({ status: 'open' })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({ error: 'invalid-transition', from: 'open', to: 'open' })
        expect(h.recordAuditEvent).not.toHaveBeenCalled()
    })

    test('handing a ticket to someone audits it as an assignment and notifies THEM', async () => {
        h.updateTicket.mockResolvedValue({ ...TICKET, assigneeUserId: 'person-staff' })

        const response = await patch({ assigneeUserId: 'person-staff' })

        expect(response.status).toBe(200)
        expect(h.recordAuditEvent).toHaveBeenCalledWith({}, expect.objectContaining({ action: 'ticket.assigned' }))
        expect(h.notifyMember).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                recipientUserId: 'person-staff',
                // The actor is excluded, so claiming a ticket yourself notifies nobody.
                excludeUserId: 'user-ada',
                kind: 'ticket.assigned',
            }),
        )
    })

    test('unassigning notifies nobody — there is no recipient to tell', async () => {
        h.ticketForOrg.mockResolvedValue({ ...TICKET, assigneeUserId: 'person-staff' })
        h.updateTicket.mockResolvedValue({ ...TICKET, assigneeUserId: null })

        const response = await patch({ assigneeUserId: null })

        expect(response.status).toBe(200)
        expect(h.recordAuditEvent).toHaveBeenCalledWith({}, expect.objectContaining({ action: 'ticket.assigned' }))
        expect(h.notifyMember).not.toHaveBeenCalled()
    })

    test('re-sending the assignee it already has is an update, not an assignment, and notifies nobody', async () => {
        h.ticketForOrg.mockResolvedValue({ ...TICKET, assigneeUserId: 'person-staff' })
        h.updateTicket.mockResolvedValue({ ...TICKET, assigneeUserId: 'person-staff' })

        await patch({ assigneeUserId: 'person-staff' })

        expect(h.recordAuditEvent).toHaveBeenCalledWith({}, expect.objectContaining({ action: 'ticket.updated' }))
        expect(h.notifyMember).not.toHaveBeenCalled()
    })

    test('404 when the row vanishes between the read and the write', async () => {
        h.updateTicket.mockResolvedValue(null)

        expect((await patch({ status: 'pending' })).status).toBe(404)
        expect(h.recordAuditEvent).not.toHaveBeenCalled()
    })
})

describe('DELETE /api/tickets/[id]', () => {
    test('200 removes the ticket and audits an event that outlives the row', async () => {
        const response = await del()

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ deleted: 'ticket-1' })
        expect(h.deleteTicket).toHaveBeenCalledWith({}, 'tenant-northwind', 'org-frontline', 'ticket-1')
        expect(h.recordAuditEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ action: 'ticket.deleted', subjectId: 'ticket-1' }),
        )
    })

    test("404 for a missing ticket, or another team's", async () => {
        h.ticketForOrg.mockResolvedValue(null)

        expect((await del()).status).toBe(404)
        expect(h.deleteTicket).not.toHaveBeenCalled()
    })

    test('403 when a restricted member tries to delete one', async () => {
        h.requireUser.mockResolvedValue(user({ role: 'restricted', restricted: true }))

        expect((await del()).status).toBe(403)
        expect(h.deleteTicket).not.toHaveBeenCalled()
        expect(h.recordAuditEvent).not.toHaveBeenCalled()
    })

    test('404 when the row is already gone by the time the delete lands', async () => {
        h.deleteTicket.mockResolvedValue(0)

        expect((await del()).status).toBe(404)
        expect(h.recordAuditEvent).not.toHaveBeenCalled()
    })
})
