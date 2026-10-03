import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { makeTestTmpDir } from '../../../../../tests/support/tmp-dir'
import { NotFoundError } from '../../ports/errors'
import { verifyServiceCaller } from '../../service-auth/verify'
import { fakeDb } from './db'
import { devWebhookSecret, mintServiceToken } from './service-auth'

const tmp = makeTestTmpDir('app-svc-mint-')
beforeAll(async () => {
    process.env.APP_DATA_DIR = tmp
    await fakeDb.ready()
})
afterAll(() => {
    delete process.env.APP_DATA_DIR
})

async function orgId(slug: string): Promise<string> {
    const row = await fakeDb
        .getDb()
        .selectFrom('organizations')
        .select('id')
        .where('slug', '=', slug)
        .executeTakeFirstOrThrow()
    return row.id
}

async function countActiveKeys(id: string): Promise<number> {
    const rows = await fakeDb
        .getDb()
        .selectFrom('service_keys')
        .select('id')
        .where('org_id', '=', id)
        .where('revoked_at', 'is', null)
        .execute()
    return rows.length
}

describe('mintServiceToken', () => {
    test('provisions a 0600 keypair + a single active row, and re-minting adds no duplicate', async () => {
        const first = await mintServiceToken('depot')

        const dir = path.join(tmp, 'auth', 'service-keys', first.tenantSlug, 'depot')
        expect(existsSync(path.join(dir, 'private.pem'))).toBe(true)
        expect(existsSync(path.join(dir, 'public.pem'))).toBe(true)
        expect(statSync(path.join(dir, 'private.pem')).mode & 0o777).toBe(0o600)
        expect(statSync(path.join(dir, 'public.pem')).mode & 0o777).toBe(0o600)
        expect(await countActiveKeys(first.orgId)).toBe(1)

        const second = await mintServiceToken('depot')
        expect(second.orgId).toBe(first.orgId)
        expect(await countActiveKeys(first.orgId)).toBe(1)
    })

    test('a key row deleted out from under a surviving keypair self-heals on the next mint', async () => {
        const id = await orgId('annex')
        await mintServiceToken('annex')
        await fakeDb.getDb().deleteFrom('service_keys').where('org_id', '=', id).execute()
        expect(await countActiveKeys(id)).toBe(0)

        await mintServiceToken('annex')
        expect(await countActiveKeys(id)).toBe(1)
    })

    test('a minted token passes the real verifyServiceCaller', async () => {
        // `wharf` is the SECOND tenant's org, and no org in the first tenant shares its slug — a
        // bare-slug mint can only resolve unambiguously while that is true (the ambiguous case is
        // manufactured deliberately in the last test of this block).
        const minted = await mintServiceToken('wharf')
        const identity = await verifyServiceCaller(
            fakeDb,
            new Request('http://localhost/api/service/jobs', {
                headers: { authorization: `Bearer ${minted.token}` },
            }),
        )
        expect(identity).toEqual({
            kind: 'org-service',
            tenantId: minted.tenantId,
            tenantSlug: 'lakeside',
            orgId: minted.orgId,
            orgSlug: 'wharf',
        })
    })

    test('an unknown org throws NotFoundError', async () => {
        await expect(mintServiceToken('no-such-org')).rejects.toBeInstanceOf(NotFoundError)
    })

    // Org slugs are only tenant-unique. A shared keypair across same-slug orgs would let a token
    // minted "for" one tenant's org verify as the other's (verify disambiguates by SIGNATURE) — so
    // keypairs are keyed by tenant+org, and a bare ambiguous slug refuses to mint at all.
    //
    // The collision is MANUFACTURED here rather than seeded: the fixture world deliberately keeps org
    // slugs unique across its two tenants (so every other case above can mint by bare slug), and this
    // test inserts the duplicate it needs, last, so nothing after it is affected.
    test('same-slug orgs in different tenants get distinct keypairs and require disambiguation', async () => {
        const alpha = await mintServiceToken('depot')
        const otherTenant = await fakeDb
            .getDb()
            .selectFrom('tenants')
            .select('id')
            .where('slug', '=', 'lakeside')
            .executeTakeFirstOrThrow()
        await fakeDb
            .getDb()
            .insertInto('organizations')
            .values({ tenant_id: otherTenant.id, slug: 'depot', name: 'Depot (collision twin)' })
            .execute()

        await expect(mintServiceToken('depot')).rejects.toThrow(/multiple tenants/)

        const demo = await mintServiceToken('depot', 'lakeside')
        expect(demo.tenantSlug).toBe('lakeside')
        expect(demo.orgId).not.toBe(alpha.orgId)

        const pub = (tenantSlug: string) =>
            readFileSync(path.join(tmp, 'auth', 'service-keys', tenantSlug, 'depot', 'public.pem'), 'utf8')
        expect(pub('lakeside')).not.toBe(pub(alpha.tenantSlug))

        // The minted token verifies as the DEMO tenant's org — the identity-confusion case dies here.
        const identity = await verifyServiceCaller(
            fakeDb,
            new Request('http://localhost/api/service/jobs', {
                headers: { authorization: `Bearer ${demo.token}` },
            }),
        )
        expect(identity.tenantId).toBe(demo.tenantId)
        expect(identity.orgId).toBe(demo.orgId)
    })
})

describe('devWebhookSecret', () => {
    test('is stable across calls and stored 0600', () => {
        const a = devWebhookSecret()
        const b = devWebhookSecret()
        expect(a).toBe(b)
        expect(a).toHaveLength(64)
        expect(statSync(path.join(tmp, 'auth', 'webhook-secret')).mode & 0o777).toBe(0o600)
    })
})
