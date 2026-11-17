import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { makeTestTmpDir } from '../../../../tests/support/tmp-dir'
import { orgIdentityForSlug, orgIdForSlug } from './org-lookup'
import { tenantIdForSlug } from './tenant-lookup'

// Fixture seed (keel's own seam): `depot` is an org of tenant `harbor`; `wharf` belongs to `lakeside`.
const tmp = makeTestTmpDir('app-org-lookup-')
beforeAll(() => {
    process.env.APP_DATA_DIR = tmp
})
afterAll(() => {
    delete process.env.APP_DATA_DIR
})

describe('orgIdentityForSlug', () => {
    test("returns one row's id and slug together, the pair abilityActorFromCredential takes", async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const harbor = (await tenantIdForSlug(fakeDb, 'harbor'))!
        const depot = await orgIdentityForSlug(fakeDb, harbor, 'depot')
        expect(depot).toEqual({ id: await orgIdForSlug(fakeDb, harbor, 'depot'), slug: 'depot' })
    })

    test("is null for another tenant's org, and for a slug no org has", async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const harbor = (await tenantIdForSlug(fakeDb, 'harbor'))!
        expect(await orgIdentityForSlug(fakeDb, harbor, 'wharf')).toBeNull()
        expect(await orgIdentityForSlug(fakeDb, harbor, 'no-such-org')).toBeNull()
    })
})
