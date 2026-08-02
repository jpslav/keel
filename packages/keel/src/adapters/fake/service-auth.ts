import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { exportPKCS8, exportSPKI, generateKeyPair, importPKCS8, SignJWT } from 'jose'
import { NotFoundError } from '../../ports/errors'
import { SERVICE_JWT_AUDIENCE } from '../../service-auth/verify'
import { writeFileAtomic, writeFileAtomicSync } from './atomic-write'
import { dataDir } from './data-dir'
import { fakeDb } from './db'

/**
 * Simulated-mode service-caller minting (NOT a port — Simulator-only, the analog of the fake sign-in
 * flow for M2M). Produces the SAME artifacts the real world would: an RS256 keypair whose public
 * half lives as a `service_keys` row and whose private half signs a short-lived JWT the caller
 * presents to /api/service/*. Verification (packages/keel/src/service-auth/verify.ts) is identical in both modes.
 *
 * Everything here lives under `.data/auth/` (private keys) and `.data/pglite` (the key rows) — BOTH
 * LIVE_DIRS a Snapshots reset wipes. So a reset takes the keypairs AND their rows out together and any
 * outstanding token immediately fails to verify: tokens die with the world, which is exactly right
 * for a simulated environment.
 */

interface ResolvedOrg {
    tenantId: string
    tenantSlug: string
    orgId: string
    orgSlug: string
}

/**
 * Org slugs are only unique WITHIN a tenant (the verify path disambiguates colliding slugs by
 * signature — each org must therefore have its OWN keypair, see keyDir). An ambiguous slug with no
 * tenantSlug given throws loudly rather than minting for an arbitrary org: a token silently issued
 * against the wrong tenant's org would be a cross-tenant identity confusion.
 */
async function resolveOrg(orgSlug: string, tenantSlug?: string): Promise<ResolvedOrg> {
    await fakeDb.ready()
    const rows = await fakeDb
        .getDb()
        .selectFrom('organizations')
        .innerJoin('tenants', 'tenants.id', 'organizations.tenant_id')
        .select([
            'organizations.id as org_id',
            'organizations.slug as org_slug',
            'organizations.tenant_id as tenant_id',
            'tenants.slug as tenant_slug',
        ])
        .where('organizations.slug', '=', orgSlug)
        .$if(tenantSlug !== undefined, (qb) => qb.where('tenants.slug', '=', tenantSlug!))
        .execute()
    if (rows.length === 0) throw new NotFoundError(`unknown org: ${orgSlug}`)
    if (rows.length > 1) {
        throw new Error(`org slug "${orgSlug}" exists in multiple tenants — pass tenantSlug to disambiguate`)
    }
    const row = rows[0]!
    return { tenantId: row.tenant_id, tenantSlug: row.tenant_slug, orgId: row.org_id, orgSlug: row.org_slug }
}

/** Keyed by tenant AND org: same-slug orgs in different tenants must never share a private key —
 *  the signature is what picks the true org when slugs collide (packages/keel/src/service-auth/verify.ts). */
function keyDir(tenantSlug: string, orgSlug: string): string {
    return dataDir('auth', 'service-keys', tenantSlug, orgSlug)
}

/** Ensures a per-org keypair exists on disk (0600), generating an extractable RS256 pair once. */
async function ensureKeypair(org: ResolvedOrg): Promise<{ privateKeyPem: string; publicKeyPem: string }> {
    const dir = keyDir(org.tenantSlug, org.orgSlug)
    const privPath = path.join(dir, 'private.pem')
    const pubPath = path.join(dir, 'public.pem')
    if (existsSync(privPath) && existsSync(pubPath)) {
        return { privateKeyPem: readFileSync(privPath, 'utf8'), publicKeyPem: readFileSync(pubPath, 'utf8') }
    }
    // CRITICAL: extractable — a non-extractable CryptoKey makes exportPKCS8/exportSPKI throw.
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true })
    const privateKeyPem = await exportPKCS8(privateKey)
    const publicKeyPem = await exportSPKI(publicKey)
    await writeFileAtomic(privPath, privateKeyPem, { mode: 0o600 })
    await writeFileAtomic(pubPath, publicKeyPem, { mode: 0o600 })
    return { privateKeyPem, publicKeyPem }
}

/**
 * Upserts the public key as an active `service_keys` row via the privileged raw handle (fake db's
 * getDb() is the pglite owner — no RLS, and this table is writable by the owner only). Inserts only
 * when no active row with this exact PEM exists, so re-minting is a no-op and a row deleted out from
 * under a surviving keypair self-heals on the next mint.
 */
async function ensureKeyRow(tenantId: string, orgId: string, publicKeyPem: string): Promise<void> {
    const db = fakeDb.getDb()
    const existing = await db
        .selectFrom('service_keys')
        .select('id')
        .where('org_id', '=', orgId)
        .where('public_key_pem', '=', publicKeyPem)
        .where('revoked_at', 'is', null)
        .executeTakeFirst()
    if (existing) return
    await db
        .insertInto('service_keys')
        .values({ tenant_id: tenantId, org_id: orgId, public_key_pem: publicKeyPem })
        .execute()
}

export interface MintedServiceToken {
    token: string
    expiresAt: string
    orgSlug: string
    tenantSlug: string
    orgId: string
    tenantId: string
}

/** Mints a fresh 15-minute service token for an org, provisioning its keypair + key row on first
 *  use. `tenantSlug` disambiguates an org slug that exists in more than one tenant. */
export async function mintServiceToken(orgSlug: string, tenantSlug?: string): Promise<MintedServiceToken> {
    const org = await resolveOrg(orgSlug, tenantSlug)
    const { privateKeyPem, publicKeyPem } = await ensureKeypair(org)
    await ensureKeyRow(org.tenantId, org.orgId, publicKeyPem)

    const now = Math.floor(Date.now() / 1000)
    const exp = now + 15 * 60
    const token = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer(org.orgSlug)
        .setAudience(SERVICE_JWT_AUDIENCE)
        .setIssuedAt(now)
        .setExpirationTime(exp)
        .sign(await importPKCS8(privateKeyPem, 'RS256'))

    return {
        token,
        expiresAt: new Date(exp * 1000).toISOString(),
        orgSlug: org.orgSlug,
        tenantSlug: org.tenantSlug,
        orgId: org.orgId,
        tenantId: org.tenantId,
    }
}

/** The per-checkout inbound-webhook secret (dev-secret pattern): lazy 32-byte hex at .data/auth, 0600. */
export function devWebhookSecret(): string {
    const file = path.join(dataDir('auth'), 'webhook-secret')
    if (!existsSync(file)) writeFileAtomicSync(file, randomBytes(32).toString('hex'), { mode: 0o600 })
    return readFileSync(file, 'utf8')
}
