import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { makeTestTmpDir } from '../../../../tests/support/tmp-dir'
import { orgIdForSlug } from './org-lookup'
import { tenantIdForSlug } from './tenant-lookup'

// Point all fake-adapter state at a throwaway dir BEFORE importing anything that touches pglite.
const tmp = makeTestTmpDir('app-audit-db-')
beforeAll(() => {
    process.env.APP_DATA_DIR = tmp
})
afterAll(() => {
    delete process.env.APP_DATA_DIR
})

/** Resolve a tenant id and one of its org ids from the seed. */
async function ids(slug: string, orgSlug: string): Promise<{ tenantId: string; orgId: string }> {
    const { fakeDb } = await import('../adapters/fake/db')
    await fakeDb.ready()
    const tenantId = await tenantIdForSlug(fakeDb, slug)
    if (!tenantId) throw new Error(`no tenant: ${slug}`)
    const orgId = await orgIdForSlug(fakeDb, tenantId, orgSlug)
    if (!orgId) throw new Error(`no org: ${orgSlug}`)
    return { tenantId, orgId }
}

describe('recordAuditEvent', () => {
    test('writes a tenant- and org-scoped event with the given action, subject type, and subject id', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { recordAuditEvent } = await import('./audit')
        const { tenantId, orgId } = await ids('harbor', 'depot')

        const subjectId = `member-${Date.now()}`
        await recordAuditEvent(fakeDb, {
            tenantId,
            orgId,
            actorUserId: 'user-ada',
            action: 'membership.invited',
            subjectType: 'Membership',
            subjectId,
        })

        const row = await fakeDb.withTenant(tenantId, (trx) =>
            trx.selectFrom('audit_events').selectAll().where('subject_id', '=', subjectId).executeTakeFirstOrThrow(),
        )
        expect(row.tenant_id).toBe(tenantId)
        expect(row.org_id).toBe(orgId)
        expect(row.actor_user_id).toBe('user-ada')
        expect(row.action).toBe('membership.invited')
        expect(row.subject_type).toBe('Membership')
        expect(row.subject_id).toBe(subjectId)
    })

    test('a subjectless action records a null subject_id (column stays honest)', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { recordAuditEvent } = await import('./audit')
        const { tenantId, orgId } = await ids('harbor', 'depot')

        await recordAuditEvent(fakeDb, {
            tenantId,
            orgId,
            actorUserId: 'user-ada',
            action: 'agreement.accepted',
            subjectType: 'AgreementAcceptance',
        })

        const row = await fakeDb.withTenant(tenantId, (trx) =>
            trx
                .selectFrom('audit_events')
                .selectAll()
                .where('action', '=', 'agreement.accepted')
                .orderBy('at', 'desc')
                .executeTakeFirstOrThrow(),
        )
        expect(row.subject_id).toBeNull()
    })

    test('records the credential an actor used (kind and id), or NULLs when the writer does not say', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { recordAuditEvent } = await import('./audit')
        const { tenantId, orgId } = await ids('harbor', 'depot')

        const byBadge = `docket-${Date.now()}-badge`
        const unsaid = `docket-${Date.now()}-unsaid`
        await recordAuditEvent(fakeDb, {
            tenantId,
            orgId,
            actorUserId: 'fixture-lead',
            credential: { kind: 'fixture-badge', id: 'badge-7' },
            action: 'membership.invited',
            subjectType: 'Membership',
            subjectId: byBadge,
        })
        await recordAuditEvent(fakeDb, {
            tenantId,
            orgId,
            actorUserId: 'system:scheduler',
            action: 'membership.invited',
            subjectType: 'Membership',
            subjectId: unsaid,
        })

        const rows = await fakeDb.withTenant(tenantId, (trx) =>
            trx
                .selectFrom('audit_events')
                .select(['subject_id', 'credential_kind', 'credential_id'])
                .where('subject_id', 'in', [byBadge, unsaid])
                .orderBy('subject_id')
                .execute(),
        )
        expect(rows).toEqual([
            { subject_id: byBadge, credential_kind: 'fixture-badge', credential_id: 'badge-7' },
            { subject_id: unsaid, credential_kind: null, credential_id: null },
        ])
    })
})

describe('auditActorOf', () => {
    test('names a person by user id and their credential; a credential-less literal is a session', async () => {
        const { auditActorOf } = await import('./audit')
        const person = {
            userId: 'fixture-lead',
            role: 'admin',
            restricted: false,
            activeOrgId: 'o',
            manageAll: false,
        } as const
        expect(auditActorOf(person)).toEqual({ actorUserId: 'fixture-lead', credential: { kind: 'session', id: null } })
        expect(auditActorOf({ ...person, credential: { kind: 'fixture-badge', id: 'badge-7' } })).toEqual({
            actorUserId: 'fixture-lead',
            credential: { kind: 'fixture-badge', id: 'badge-7' },
        })
    })

    test('names a machine by its kind-qualified principal and the credential it presented', async () => {
        const { auditActorOf } = await import('./audit')
        const robot = {
            kind: 'machine',
            credential: { kind: 'service-key', id: 'key-1' },
            principalId: 'service-key:wharf',
            activeOrgId: 'o',
        } as const
        expect(auditActorOf(robot)).toEqual({
            actorUserId: 'service-key:wharf',
            credential: { kind: 'service-key', id: 'key-1' },
        })
    })
})
