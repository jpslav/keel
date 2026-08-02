import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { orgIdForSlug } from 'keel/db/org-lookup'
import { tenantIdForSlug } from 'keel/db/tenant-lookup'

// Point all fake-adapter state at a throwaway dir BEFORE importing anything that touches pglite.
const tmp = mkdtempSync(path.join(tmpdir(), 'app-attachments-db-'))
beforeAll(() => {
    process.env.APP_DATA_DIR = tmp
})
afterAll(() => {
    delete process.env.APP_DATA_DIR
})

/** Resolve a tenant id and one of its org ids from the seed (uploader ids are auth-port strings,
 *  not a DB table — any stable literal works). */
async function ids(slug: string, orgSlug: string): Promise<{ tenantId: string; orgId: string }> {
    const { fakeDb } = await import('keel/adapters/fake/db')
    await fakeDb.ready()
    const tenantId = await tenantIdForSlug(fakeDb, slug)
    if (!tenantId) throw new Error(`no tenant: ${slug}`)
    const orgId = await orgIdForSlug(fakeDb, tenantId, orgSlug)
    if (!orgId) throw new Error(`no org: ${orgSlug}`)
    return { tenantId, orgId }
}

describe('confirmAttachment', () => {
    test('flips pending to ready once — a re-confirm can never rewrite the recorded size', async () => {
        const { fakeDb } = await import('keel/adapters/fake/db')
        const { attachmentForOrg, confirmAttachment, createAttachment } = await import('./attachments')
        const { tenantId, orgId } = await ids('northwind', 'frontline')

        const { id } = await createAttachment(fakeDb, {
            tenantId,
            orgId,
            kind: 'upload',
            filename: 'report.csv',
            contentType: 'text/csv',
            storageKey: `attachments/${tenantId}/${orgId}/report.csv`,
            uploadedByUserId: 'user-ada',
        })
        expect((await attachmentForOrg(fakeDb, tenantId, orgId, id))!.status).toBe('pending')

        expect(await confirmAttachment(fakeDb, tenantId, orgId, id, 42)).toBe(1)
        expect((await attachmentForOrg(fakeDb, tenantId, orgId, id))!.status).toBe('ready')

        // pending-only guard: once ready, a second confirm (e.g. after an out-of-band byte swap)
        // is a 0-row no-op — the size recorded at first confirm stays the truth.
        expect(await confirmAttachment(fakeDb, tenantId, orgId, id, 9999)).toBe(0)
        const sized = await fakeDb.withTenant(tenantId, (trx) =>
            trx.selectFrom('attachments').select('size_bytes').where('id', '=', id).executeTakeFirstOrThrow(),
        )
        expect(Number(sized.size_bytes)).toBe(42)
    })
})
