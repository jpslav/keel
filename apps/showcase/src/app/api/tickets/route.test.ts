import { beforeEach, describe, expect, test, vi } from 'vitest'
import { TICKET_PAGE_SIZE } from '@/domain/tickets'
import type { AuthUser } from 'keel/ports/auth'
import { GET, POST } from './route'

// Real authorize (pure abilities) runs — only the adapters and data modules are faked. Low-entropy
// fixture ids/slugs (gitleaks): no hex, no UUIDs.
const h = vi.hoisted(() => ({
    requireUser: vi.fn(),
    tenantIdForSlug: vi.fn(),
    orgIdForSlug: vi.fn(),
    createTicket: vi.fn(),
    listTickets: vi.fn(),
    recordAuditEvent: vi.fn(),
}))
vi.mock('keel/adapters/index', () => ({ auth: { requireUser: h.requireUser }, db: {} }))
vi.mock('keel/db/tenant-lookup', () => ({ tenantIdForSlug: h.tenantIdForSlug }))
vi.mock('keel/db/org-lookup', () => ({ orgIdForSlug: h.orgIdForSlug }))
vi.mock('keel/db/audit', () => ({ recordAuditEvent: h.recordAuditEvent }))
vi.mock('@/domain/db/tickets', () => ({ createTicket: h.createTicket, listTickets: h.listTickets }))

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

function post(body: unknown): Promise<Response> {
    return POST(
        new Request('http://localhost/api/tickets', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        }),
    )
}

beforeEach(() => {
    for (const fn of Object.values(h)) fn.mockReset()
    h.requireUser.mockResolvedValue(user())
    h.tenantIdForSlug.mockResolvedValue('tenant-northwind')
    h.orgIdForSlug.mockImplementation(async (_db: unknown, _tenantId: string, slug: string) => ORG_IDS[slug] ?? null)
    h.createTicket.mockResolvedValue({ id: 'ticket-1', ref: 'NW-1042' })
    h.listTickets.mockResolvedValue({ tickets: [], nextCursor: null })
})

describe('POST /api/tickets (open)', () => {
    test('201 opens a ticket in the active org and records the audit event', async () => {
        const response = await post({ subject: 'Printer prints blank labels', body: 'Both machines.' })

        expect(response.status).toBe(201)
        expect(await response.json()).toEqual({ ticket: { id: 'ticket-1', ref: 'NW-1042' } })
        expect(h.createTicket).toHaveBeenCalledWith(
            {},
            {
                tenantId: 'tenant-northwind',
                fallbackSlug: 'northwind',
                orgId: 'org-frontline',
                subject: 'Printer prints blank labels',
                body: 'Both machines.',
            },
        )
        expect(h.recordAuditEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ action: 'ticket.created', subjectType: 'Ticket', subjectId: 'ticket-1' }),
        )
    })

    test('trims the subject and body, and treats an absent body as empty', async () => {
        await post({ subject: '  spaced  ', body: '  padded  ' })
        expect(h.createTicket).toHaveBeenCalledWith({}, expect.objectContaining({ subject: 'spaced', body: 'padded' }))

        h.createTicket.mockClear()
        await post({ subject: 'no body' })
        expect(h.createTicket).toHaveBeenCalledWith({}, expect.objectContaining({ body: '' }))
    })

    test('400 on a missing or blank subject', async () => {
        expect((await post({ body: 'orphan' })).status).toBe(400)
        expect((await post({ subject: '   ', body: 'orphan' })).status).toBe(400)
        expect(h.createTicket).not.toHaveBeenCalled()
    })

    test('403 when a restricted member tries to open one — they may read the queue, not add to it', async () => {
        h.requireUser.mockResolvedValue(user({ role: 'restricted', restricted: true }))

        const response = await post({ subject: 'x' })

        expect(response.status).toBe(403)
        expect(h.createTicket).not.toHaveBeenCalled()
        expect(h.recordAuditEvent).not.toHaveBeenCalled()
    })

    test('404 when the tenant or the active org cannot be resolved', async () => {
        h.tenantIdForSlug.mockResolvedValue(null)
        expect((await post({ subject: 'x' })).status).toBe(404)

        h.tenantIdForSlug.mockResolvedValue('tenant-northwind')
        h.requireUser.mockResolvedValue(user({ orgSlug: 'ghost' }))
        expect((await post({ subject: 'x' })).status).toBe(404)

        expect(h.createTicket).not.toHaveBeenCalled()
    })

    test('the audit event is recorded only AFTER the write, never for a refused one', async () => {
        h.createTicket.mockRejectedValue(new Error('db down'))

        await expect(post({ subject: 'x' })).rejects.toThrow('db down')
        expect(h.recordAuditEvent).not.toHaveBeenCalled()
    })
})

/** The queue endpoint reads its cursor and limit off the URL, so a GET needs a real Request. */
const queueRequest = (query = '') => new Request(`http://localhost/api/tickets${query}`)

describe('GET /api/tickets (queue)', () => {
    test('returns the active org queue, tenant- and org-scoped', async () => {
        h.listTickets.mockResolvedValue({ tickets: [{ id: 'ticket-1', ref: 'NW-1041' }], nextCursor: null })

        const response = await GET(queueRequest())

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ tickets: [{ id: 'ticket-1', ref: 'NW-1041' }], nextCursor: null })
        // The paging options are the route's own: the query string may ASK, it does not decide.
        expect(h.listTickets).toHaveBeenCalledWith({}, 'tenant-northwind', 'org-frontline', {
            after: null,
            limit: TICKET_PAGE_SIZE,
        })
    })

    test('a restricted member may still READ the queue', async () => {
        h.requireUser.mockResolvedValue(user({ role: 'restricted', restricted: true }))

        expect((await GET(queueRequest())).status).toBe(200)
    })
})
