import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { makeTestTmpDir } from '../../../../../tests/support/tmp-dir'
import { orgIdForSlug } from 'keel/db/org-lookup'
import { tenantIdForSlug } from 'keel/db/tenant-lookup'
import { InvalidTransitionError } from 'keel/core/state-machine'

const NIL_UUID = '00000000-0000-0000-0000-000000000000'

// Point all fake-adapter state at a throwaway dir BEFORE importing anything that touches pglite.
const tmp = makeTestTmpDir('app-escalations-db-')
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
    const tenantId = await tenantIdForSlug(fakeDb, slug)
    if (!tenantId) throw new Error(`no tenant: ${slug}`)
    const orgId = await orgIdForSlug(fakeDb, tenantId, orgSlug)
    if (!orgId) throw new Error(`no org: ${orgSlug}`)
    return { tenantId, orgId }
}

/** Create a fresh alpha org (bystander for the two-sided proofs), as the privileged migration user. */
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

describe('createEscalation + listEscalations', () => {
    test('a request is SENT from the requester and RECEIVED by the responder, invisible to a bystander', async () => {
        const { fakeDb } = await import('keel/adapters/fake/db')
        const { createEscalation, listEscalations } = await import('./escalations')
        const research = await ids('northwind', 'frontline')
        const outreach = await ids('northwind', 'platform')
        const bystanderOrgId = await makeOrg(research.tenantId, `bystander-${Date.now()}`, 'Bystander Team')

        const { id } = await createEscalation(fakeDb, {
            tenantId: research.tenantId,
            requesterOrgId: research.orgId,
            responderOrgId: outreach.orgId,
            createdByUserId: 'user-ada',
            subject: 'collab please',
            body: 'we would like to work together',
        })

        // The requester sees it under "sent".
        const asRequester = await listEscalations(fakeDb, research.tenantId, research.orgId)
        const sent = asRequester.sent.find((r) => r.id === id)
        expect(sent).toBeDefined()
        expect(asRequester.received.some((r) => r.id === id)).toBe(false)
        expect(sent!.requesterOrgName).toBe('Frontline Desk')
        expect(sent!.responderOrgName).toBe('Platform Team')
        expect(sent!.status).toBe('open')

        // The responder sees the SAME row under "received".
        const asResponder = await listEscalations(fakeDb, research.tenantId, outreach.orgId)
        expect(asResponder.received.some((r) => r.id === id)).toBe(true)
        expect(asResponder.sent.some((r) => r.id === id)).toBe(false)

        // A bystander org in the same tenant sees it on neither side.
        const asBystander = await listEscalations(fakeDb, research.tenantId, bystanderOrgId)
        expect(asBystander.sent.some((r) => r.id === id)).toBe(false)
        expect(asBystander.received.some((r) => r.id === id)).toBe(false)
    })
})

describe('escalationForActiveOrg', () => {
    test('resolves for either party, returns null for a bystander or an absent id', async () => {
        const { fakeDb } = await import('keel/adapters/fake/db')
        const { createEscalation, escalationForActiveOrg } = await import('./escalations')
        const research = await ids('northwind', 'frontline')
        const outreach = await ids('northwind', 'platform')

        const { id } = await createEscalation(fakeDb, {
            tenantId: research.tenantId,
            requesterOrgId: research.orgId,
            responderOrgId: outreach.orgId,
            createdByUserId: 'user-ada',
            subject: 's',
            body: 'b',
        })

        const forRequester = await escalationForActiveOrg(fakeDb, research.tenantId, research.orgId, id)
        expect(forRequester).toEqual({
            id,
            status: 'open',
            requesterOrgId: research.orgId,
            responderOrgId: outreach.orgId,
        })
        // The responder also resolves it (either side is a party).
        expect((await escalationForActiveOrg(fakeDb, research.tenantId, outreach.orgId, id))?.id).toBe(id)
        // A bystander org — indistinguishable from absent.
        const bystanderOrgId = await makeOrg(research.tenantId, `bystander2-${Date.now()}`, 'Bystander Two')
        expect(await escalationForActiveOrg(fakeDb, research.tenantId, bystanderOrgId, id)).toBeNull()
        // An absent id.
        expect(await escalationForActiveOrg(fakeDb, research.tenantId, research.orgId, NIL_UUID)).toBeNull()
    })
})

describe('transitionEscalation', () => {
    test('allows a legal decision and records who acted, then refuses a second decision', async () => {
        const { fakeDb } = await import('keel/adapters/fake/db')
        const { createEscalation, transitionEscalation, escalationForActiveOrg } = await import('./escalations')
        const research = await ids('northwind', 'frontline')
        const outreach = await ids('northwind', 'platform')

        const { id } = await createEscalation(fakeDb, {
            tenantId: research.tenantId,
            requesterOrgId: research.orgId,
            responderOrgId: outreach.orgId,
            createdByUserId: 'user-ada',
            subject: 's',
            body: 'b',
        })

        // open -> accepted is legal.
        await transitionEscalation(fakeDb, research.tenantId, id, 'accepted', { byUserId: 'user-responder' })
        expect((await escalationForActiveOrg(fakeDb, research.tenantId, outreach.orgId, id))?.status).toBe('accepted')

        // accepted is terminal — a second decision (double-accept, or reject) is rejected.
        await expect(
            transitionEscalation(fakeDb, research.tenantId, id, 'rejected', { byUserId: 'user-responder' }),
        ).rejects.toThrow(InvalidTransitionError)
    })

    test('withdrawal is a soft transition open -> cancelled', async () => {
        const { fakeDb } = await import('keel/adapters/fake/db')
        const { createEscalation, transitionEscalation, escalationForActiveOrg } = await import('./escalations')
        const research = await ids('northwind', 'frontline')
        const outreach = await ids('northwind', 'platform')

        const { id } = await createEscalation(fakeDb, {
            tenantId: research.tenantId,
            requesterOrgId: research.orgId,
            responderOrgId: outreach.orgId,
            createdByUserId: 'user-ada',
            subject: 's',
            body: 'b',
        })

        await transitionEscalation(fakeDb, research.tenantId, id, 'cancelled', { byUserId: 'user-ada' })
        expect((await escalationForActiveOrg(fakeDb, research.tenantId, research.orgId, id))?.status).toBe('cancelled')
    })
})
