import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { makeTestTmpDir } from '../../../../../tests/support/tmp-dir'
import { InvalidTransitionError } from 'keel/core/state-machine'
import type { DbPort } from 'keel/ports/db'

const MISSING_ID = '00000000-0000-0000-0000-000000000000'

// Point all fake-adapter state at a throwaway dir BEFORE importing anything that touches pglite.
const tmp = makeTestTmpDir('app-tickets-db-')
beforeAll(() => {
    process.env.APP_DATA_DIR = tmp
})
afterAll(() => {
    delete process.env.APP_DATA_DIR
})

/** Resolve a tenant id and one of its org ids from the seed. */
async function ids(slug: string, orgSlug: string): Promise<{ tenantId: string; orgId: string }> {
    const { fakeDb } = await import('keel/adapters/fake/db')
    await fakeDb.ready()
    const tenant = await fakeDb
        .getDb()
        .selectFrom('tenants')
        .select('id')
        .where('slug', '=', slug)
        .executeTakeFirstOrThrow()
    const org = await fakeDb
        .getDb()
        .selectFrom('organizations')
        .select('id')
        .where('tenant_id', '=', tenant.id)
        .where('slug', '=', orgSlug)
        .executeTakeFirstOrThrow()
    return { tenantId: tenant.id, orgId: org.id }
}

/** A fresh org to stand in for another team, as the privileged migration user. */
async function makeOrg(tenantId: string, slug: string, name: string): Promise<string> {
    const { fakeDb } = await import('keel/adapters/fake/db')
    const org = await fakeDb
        .getDb()
        .insertInto('organizations')
        .values({ tenant_id: tenantId, slug, name })
        .returning('id')
        .executeTakeFirstOrThrow()
    return org.id
}

async function open(orgId: string, tenantId: string, subject: string) {
    const { fakeDb } = await import('keel/adapters/fake/db')
    const { createTicket } = await import('./tickets')
    return createTicket(fakeDb, { tenantId, fallbackSlug: 'northwind', orgId, subject, body: `${subject} body` })
}

describe('createTicket + listTickets', () => {
    test('a ticket is visible to its own team and invisible to another team in the same tenant', async () => {
        const { fakeDb } = await import('keel/adapters/fake/db')
        const { listTickets } = await import('./tickets')
        const frontline = await ids('northwind', 'frontline')
        const otherOrgId = await makeOrg(frontline.tenantId, `bystander-tickets-${Date.now()}`, 'Bystander Team')

        const mine = await open(frontline.orgId, frontline.tenantId, 'Printer feeds blank labels')

        const ours = await listTickets(fakeDb, frontline.tenantId, frontline.orgId)
        const theirs = await listTickets(fakeDb, frontline.tenantId, otherOrgId)
        expect(ours.tickets.map((t) => t.id)).toContain(mine.id)
        expect(theirs.tickets.map((t) => t.id)).not.toContain(mine.id)
    })

    test('opens at status open, unassigned, with a ref that continues the tenant series', async () => {
        const frontline = await ids('northwind', 'frontline')

        const ticket = await open(frontline.orgId, frontline.tenantId, 'Scanner drops wifi')

        expect(ticket.status).toBe('open')
        expect(ticket.assigneeUserId).toBeNull()
        // The seeded Northwind queue is an NW- series, and a new ticket joins it rather than starting over.
        expect(ticket.ref).toMatch(/^NW-\d+$/)
    })

    test('consecutive creates take consecutive references', async () => {
        const frontline = await ids('northwind', 'frontline')

        const first = await open(frontline.orgId, frontline.tenantId, 'First')
        const second = await open(frontline.orgId, frontline.tenantId, 'Second')

        const number = (ref: string) => Number(ref.split('-')[1])
        expect(number(second.ref)).toBe(number(first.ref) + 1)
    })

    test('newest first', async () => {
        const { fakeDb } = await import('keel/adapters/fake/db')
        const { listTickets } = await import('./tickets')
        const frontline = await ids('northwind', 'frontline')

        const newest = await open(frontline.orgId, frontline.tenantId, 'Newest')

        const rows = await listTickets(fakeDb, frontline.tenantId, frontline.orgId)
        expect(rows.tickets[0]!.id).toBe(newest.id)
    })

    /**
     * The reference race, driven through a stub port rather than a real one: two agents pressing
     * "Open ticket" at the same instant is not reproducible on demand, but the thing worth proving is
     * the RECOVERY — a create that loses the race re-reads the queue and takes the next free number
     * instead of handing a 500 to someone whose request was perfectly valid.
     */
    test('retries when another transaction takes the reference first', async () => {
        const { createTicket } = await import('./tickets')
        let attempts = 0
        const collidingOnce: DbPort = {
            getDb: () => {
                throw new Error('not used')
            },
            ready: async () => {},
            migrateToLatest: async () => {},
            withTenant: async <T>(_tenantId: string, fn: (trx: never) => Promise<T>): Promise<T> => {
                attempts += 1
                if (attempts === 1) {
                    throw Object.assign(new Error('duplicate key'), {
                        code: '23505',
                        constraint: 'tickets_tenant_ref_idx',
                    })
                }
                return fn({
                    selectFrom: () => ({ select: () => ({ execute: async () => [{ ref: 'NW-1041' }] }) }),
                    insertInto: () => ({
                        values: () => ({
                            returning: () => ({
                                executeTakeFirstOrThrow: async () => ({
                                    id: 'ticket-1',
                                    ref: 'NW-1042',
                                    subject: 'Retried',
                                    body: '',
                                    status: 'open',
                                    assignee_user_id: null,
                                    created_at: '2026-07-31T12:00:00.000Z',
                                    updated_at: '2026-07-31T12:00:00.000Z',
                                }),
                            }),
                        }),
                    }),
                } as never)
            },
        }

        const ticket = await createTicket(collidingOnce, {
            tenantId: 'tenant-northwind',
            fallbackSlug: 'northwind',
            orgId: 'org-frontline',
            subject: 'Retried',
            body: '',
        })

        expect(attempts).toBe(2)
        expect(ticket.ref).toBe('NW-1042')
    })

    test('does NOT retry a failure that is not a reference collision', async () => {
        const { createTicket } = await import('./tickets')
        let attempts = 0
        const alwaysBroken: DbPort = {
            getDb: () => {
                throw new Error('not used')
            },
            ready: async () => {},
            migrateToLatest: async () => {},
            withTenant: async () => {
                attempts += 1
                throw Object.assign(new Error('null value in column'), { code: '23502' })
            },
        }

        await expect(
            createTicket(alwaysBroken, {
                tenantId: 'tenant-northwind',
                fallbackSlug: 'northwind',
                orgId: 'org-frontline',
                subject: 'Doomed',
                body: '',
            }),
        ).rejects.toThrow('null value in column')
        expect(attempts).toBe(1)
    })
})

describe('ticketForOrg', () => {
    test("another team's ticket is indistinguishable from a missing one", async () => {
        const { fakeDb } = await import('keel/adapters/fake/db')
        const { ticketForOrg } = await import('./tickets')
        const frontline = await ids('northwind', 'frontline')
        const otherOrgId = await makeOrg(frontline.tenantId, `probe-tickets-${Date.now()}`, 'Probe Team')

        const mine = await open(frontline.orgId, frontline.tenantId, 'Refund missing')

        expect(await ticketForOrg(fakeDb, frontline.tenantId, frontline.orgId, mine.id)).not.toBeNull()
        // Both a foreign id and a nonexistent one come back null, so ids cannot be probed.
        expect(await ticketForOrg(fakeDb, frontline.tenantId, otherOrgId, mine.id)).toBeNull()
        expect(await ticketForOrg(fakeDb, frontline.tenantId, frontline.orgId, MISSING_ID)).toBeNull()
    })
})

describe('updateTicket', () => {
    test('advances the status through a legal hop', async () => {
        const { fakeDb } = await import('keel/adapters/fake/db')
        const { updateTicket } = await import('./tickets')
        const frontline = await ids('northwind', 'frontline')
        const ticket = await open(frontline.orgId, frontline.tenantId, 'Legal hop')

        const updated = await updateTicket(fakeDb, frontline.tenantId, frontline.orgId, ticket.id, {
            status: 'pending',
        })

        expect(updated?.status).toBe('pending')
    })

    test('an illegal hop throws and writes nothing', async () => {
        const { fakeDb } = await import('keel/adapters/fake/db')
        const { ticketForOrg, updateTicket } = await import('./tickets')
        const frontline = await ids('northwind', 'frontline')
        const ticket = await open(frontline.orgId, frontline.tenantId, 'Illegal hop')

        await expect(
            updateTicket(fakeDb, frontline.tenantId, frontline.orgId, ticket.id, { status: 'open' }),
        ).rejects.toBeInstanceOf(InvalidTransitionError)

        const after = await ticketForOrg(fakeDb, frontline.tenantId, frontline.orgId, ticket.id)
        expect(after?.status).toBe('open')
    })

    test('assignee is three-state: absent leaves it, a string assigns, null unassigns', async () => {
        const { fakeDb } = await import('keel/adapters/fake/db')
        const { updateTicket } = await import('./tickets')
        const frontline = await ids('northwind', 'frontline')
        const ticket = await open(frontline.orgId, frontline.tenantId, 'Three-state assignee')

        const assigned = await updateTicket(fakeDb, frontline.tenantId, frontline.orgId, ticket.id, {
            assigneeUserId: 'person-admin',
        })
        expect(assigned?.assigneeUserId).toBe('person-admin')

        // Absent: a status-only change must not clear the assignee.
        const statusOnly = await updateTicket(fakeDb, frontline.tenantId, frontline.orgId, ticket.id, {
            status: 'pending',
        })
        expect(statusOnly?.assigneeUserId).toBe('person-admin')

        const unassigned = await updateTicket(fakeDb, frontline.tenantId, frontline.orgId, ticket.id, {
            assigneeUserId: null,
        })
        expect(unassigned?.assigneeUserId).toBeNull()
    })

    test("returns null for another team's ticket rather than updating it", async () => {
        const { fakeDb } = await import('keel/adapters/fake/db')
        const { ticketForOrg, updateTicket } = await import('./tickets')
        const frontline = await ids('northwind', 'frontline')
        const otherOrgId = await makeOrg(frontline.tenantId, `foreign-update-${Date.now()}`, 'Foreign Team')
        const ticket = await open(frontline.orgId, frontline.tenantId, 'Not yours')

        expect(await updateTicket(fakeDb, frontline.tenantId, otherOrgId, ticket.id, { status: 'resolved' })).toBeNull()

        const after = await ticketForOrg(fakeDb, frontline.tenantId, frontline.orgId, ticket.id)
        expect(after?.status).toBe('open')
    })

    test('bumps updated_at', async () => {
        const { fakeDb } = await import('keel/adapters/fake/db')
        const { updateTicket } = await import('./tickets')
        const frontline = await ids('northwind', 'frontline')
        const ticket = await open(frontline.orgId, frontline.tenantId, 'Touch me')

        const updated = await updateTicket(fakeDb, frontline.tenantId, frontline.orgId, ticket.id, {
            status: 'resolved',
        })

        expect(Date.parse(updated!.updatedAt)).toBeGreaterThanOrEqual(Date.parse(ticket.updatedAt))
    })
})

describe('deleteTicket', () => {
    test('removes the row and reports one deleted', async () => {
        const { fakeDb } = await import('keel/adapters/fake/db')
        const { deleteTicket, ticketForOrg } = await import('./tickets')
        const frontline = await ids('northwind', 'frontline')
        const ticket = await open(frontline.orgId, frontline.tenantId, 'Delete me')

        expect(await deleteTicket(fakeDb, frontline.tenantId, frontline.orgId, ticket.id)).toBe(1)
        expect(await ticketForOrg(fakeDb, frontline.tenantId, frontline.orgId, ticket.id)).toBeNull()
    })

    test("reports zero for another team's ticket, and leaves it alone", async () => {
        const { fakeDb } = await import('keel/adapters/fake/db')
        const { deleteTicket, ticketForOrg } = await import('./tickets')
        const frontline = await ids('northwind', 'frontline')
        const otherOrgId = await makeOrg(frontline.tenantId, `foreign-delete-${Date.now()}`, 'Foreign Team')
        const ticket = await open(frontline.orgId, frontline.tenantId, 'Survivor')

        expect(await deleteTicket(fakeDb, frontline.tenantId, otherOrgId, ticket.id)).toBe(0)
        expect(await ticketForOrg(fakeDb, frontline.tenantId, frontline.orgId, ticket.id)).not.toBeNull()
    })

    test('reports zero for an id that never existed', async () => {
        const { fakeDb } = await import('keel/adapters/fake/db')
        const { deleteTicket } = await import('./tickets')
        const frontline = await ids('northwind', 'frontline')

        expect(await deleteTicket(fakeDb, frontline.tenantId, frontline.orgId, MISSING_ID)).toBe(0)
    })
})
