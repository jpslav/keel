import { exportSPKI, generateKeyPair, SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { makeTestTmpDir } from '../../../../tests/support/tmp-dir'
import { fakeDb } from '../adapters/fake/db'
import { AuthRequiredError } from '../ports/errors'
import { SERVICE_JWT_AUDIENCE, verifyServiceCaller } from './verify'

// Real RS256 crypto against real pglite rows in a throwaway data dir — verify.ts imports no vendor
// adapters, so nothing here trips `server-only` and the whole verification path runs for real.
const tmp = makeTestTmpDir('app-svc-verify-')

interface OrgRef {
    tenantId: string
    tenantSlug: string
    orgId: string
    orgSlug: string
}

async function makeOrg(slug: string): Promise<OrgRef> {
    const db = fakeDb.getDb()
    const tenant = await db
        .selectFrom('tenants')
        .select(['id', 'slug'])
        .where('slug', '=', 'harbor')
        .executeTakeFirstOrThrow()
    const org = await db
        .insertInto('organizations')
        .values({ tenant_id: tenant.id, slug, name: slug })
        .returning('id')
        .executeTakeFirstOrThrow()
    return { tenantId: tenant.id, tenantSlug: tenant.slug, orgId: org.id, orgSlug: slug }
}

async function insertKey(org: OrgRef, publicKeyPem: string, revoked = false): Promise<void> {
    await fakeDb
        .getDb()
        .insertInto('service_keys')
        .values({
            tenant_id: org.tenantId,
            org_id: org.orgId,
            public_key_pem: publicKeyPem,
            revoked_at: revoked ? new Date().toISOString() : null,
        })
        .execute()
}

async function genKeypair() {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true })
    return { privateKey, publicKeyPem: await exportSPKI(publicKey) }
}

function req(token: string): Request {
    return new Request('http://localhost/api/service/jobs', { headers: { authorization: `Bearer ${token}` } })
}

const expectReject = (token: string) =>
    expect(verifyServiceCaller(fakeDb, req(token))).rejects.toBeInstanceOf(AuthRequiredError)

interface Fixture {
    orgValid: OrgRef
    orgRotate: OrgRef
    validToken: string
    expiredToken: string
    iatOldToken: string
    wrongAudToken: string
    missingExpToken: string
    missingIatToken: string
    hs256Token: string
    foreignSigToken: string
    unknownOrgToken: string
    revokedKeyToken: string
    rotationToken: string
}

let fx: Fixture

beforeAll(async () => {
    process.env.APP_DATA_DIR = tmp
    await fakeDb.ready()

    const now = Math.floor(Date.now() / 1000)

    const orgValid = await makeOrg('svc-valid')
    const kpValid = await genKeypair()
    await insertKey(orgValid, kpValid.publicKeyPem)

    const validToken = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer(orgValid.orgSlug)
        .setAudience(SERVICE_JWT_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(kpValid.privateKey)

    const expiredToken = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer(orgValid.orgSlug)
        .setAudience(SERVICE_JWT_AUDIENCE)
        .setIssuedAt(now - 120)
        .setExpirationTime(now - 60)
        .sign(kpValid.privateKey)

    const iatOldToken = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer(orgValid.orgSlug)
        .setAudience(SERVICE_JWT_AUDIENCE)
        .setIssuedAt(now - 16 * 60)
        .setExpirationTime(now + 5 * 60)
        .sign(kpValid.privateKey)

    const wrongAudToken = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer(orgValid.orgSlug)
        .setAudience('some-other-audience')
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(kpValid.privateKey)

    const missingExpToken = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer(orgValid.orgSlug)
        .setAudience(SERVICE_JWT_AUDIENCE)
        .setIssuedAt()
        .sign(kpValid.privateKey)

    const missingIatToken = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer(orgValid.orgSlug)
        .setAudience(SERVICE_JWT_AUDIENCE)
        .setExpirationTime('15m')
        .sign(kpValid.privateKey)

    // HS256 signed with the PEM text as the shared secret — the classic alg-confusion attempt. The
    // algorithms allowlist (RS256 only) must reject it outright.
    const hs256Token = await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer(orgValid.orgSlug)
        .setAudience(SERVICE_JWT_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(new TextEncoder().encode(kpValid.publicKeyPem))

    // A real org whose stored key does NOT match the signer of this token.
    const orgForeign = await makeOrg('svc-foreign')
    await insertKey(orgForeign, (await genKeypair()).publicKeyPem)
    const kpOther = await genKeypair()
    const foreignSigToken = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer(orgForeign.orgSlug)
        .setAudience(SERVICE_JWT_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(kpOther.privateKey)

    // iss points at an org that has no rows at all.
    const kpGhost = await genKeypair()
    const unknownOrgToken = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer('svc-does-not-exist')
        .setAudience(SERVICE_JWT_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(kpGhost.privateKey)

    // A key that exists but is revoked — a token validly signed by it must still be rejected.
    const orgRevoked = await makeOrg('svc-revoked')
    const kpRevoked = await genKeypair()
    await insertKey(orgRevoked, kpRevoked.publicKeyPem, true)
    const revokedKeyToken = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer(orgRevoked.orgSlug)
        .setAudience(SERVICE_JWT_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(kpRevoked.privateKey)

    // Rotation: two active keys, token signed by the NEWER one — the loop must find it among candidates.
    const orgRotate = await makeOrg('svc-rotate')
    const kpOld = await genKeypair()
    const kpNew = await genKeypair()
    await insertKey(orgRotate, kpOld.publicKeyPem)
    await insertKey(orgRotate, kpNew.publicKeyPem)
    const rotationToken = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer(orgRotate.orgSlug)
        .setAudience(SERVICE_JWT_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(kpNew.privateKey)

    fx = {
        orgValid,
        orgRotate,
        validToken,
        expiredToken,
        iatOldToken,
        wrongAudToken,
        missingExpToken,
        missingIatToken,
        hs256Token,
        foreignSigToken,
        unknownOrgToken,
        revokedKeyToken,
        rotationToken,
    }
}, 30_000)

afterAll(() => {
    delete process.env.APP_DATA_DIR
})

describe('verifyServiceCaller', () => {
    test('a valid token resolves to the org identity with all ids', async () => {
        const identity = await verifyServiceCaller(fakeDb, req(fx.validToken))
        expect(identity).toEqual({
            kind: 'org-service',
            tenantId: fx.orgValid.tenantId,
            tenantSlug: 'harbor',
            orgId: fx.orgValid.orgId,
            orgSlug: 'svc-valid',
        })
    })

    test('a rotation second active key still verifies', async () => {
        const identity = await verifyServiceCaller(fakeDb, req(fx.rotationToken))
        expect(identity.orgSlug).toBe('svc-rotate')
        expect(identity.orgId).toBe(fx.orgRotate.orgId)
        expect(identity.tenantId).toBe(fx.orgRotate.tenantId)
    })

    test('an expired token is rejected', () => expectReject(fx.expiredToken))
    test('an iat older than 15m is rejected', () => expectReject(fx.iatOldToken))
    test('a wrong audience is rejected', () => expectReject(fx.wrongAudToken))
    test('a token missing exp is rejected', () => expectReject(fx.missingExpToken))
    test('a token missing iat is rejected', () => expectReject(fx.missingIatToken))
    test('an HS256 token is rejected', () => expectReject(fx.hs256Token))
    test("another key's signature for the org is rejected", () => expectReject(fx.foreignSigToken))
    test('an unknown org is rejected', () => expectReject(fx.unknownOrgToken))
    test('a revoked key is rejected', () => expectReject(fx.revokedKeyToken))

    test('malformed / missing headers throw AuthRequiredError, never a crash', async () => {
        await expectReject('not-a-jwt')
        await expectReject('a.b.c')
        await expect(verifyServiceCaller(fakeDb, new Request('http://localhost/x'))).rejects.toBeInstanceOf(
            AuthRequiredError,
        )
        await expect(
            verifyServiceCaller(fakeDb, new Request('http://localhost/x', { headers: { authorization: 'Basic zzz' } })),
        ).rejects.toBeInstanceOf(AuthRequiredError)
    })
})
