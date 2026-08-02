import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { orgIdForSlug } from './org-lookup'
import { tenantIdForSlug } from './tenant-lookup'

// Point all fake-adapter state at a throwaway dir BEFORE importing anything that touches pglite.
const tmp = mkdtempSync(path.join(tmpdir(), 'app-audit-db-'))
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
})
