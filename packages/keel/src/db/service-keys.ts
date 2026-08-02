import type { DbPort } from '../ports/db'

/** One active (non-revoked) service key, joined to the org and tenant it authenticates a caller for. */
export interface ActiveServiceKey {
    publicKeyPem: string
    tenantId: string
    tenantSlug: string
    orgId: string
    orgSlug: string
}

/**
 * Every ACTIVE (revoked_at IS NULL) service key whose org has this slug, joined to org + tenant.
 * A raw getDb() read of the RLS-free `service_keys` infra table — this runs during request
 * AUTHENTICATION, before any tenant context exists (resolving the caller is what establishes it).
 *
 * May return keys spanning MORE THAN ONE tenant when two tenants reuse an org slug: the caller
 * (verifyServiceCaller) then tries each key's public half against the token signature, and the one
 * that cryptographically verifies picks the true org. Slug alone never grants identity here.
 */
export async function activeKeysForOrgSlug(db: DbPort, orgSlug: string): Promise<ActiveServiceKey[]> {
    // Cold-start guard: the fake db migrates+seeds lazily; don't read before that completes.
    await db.ready()
    const rows = await db
        .getDb()
        .selectFrom('service_keys')
        .innerJoin('organizations', 'organizations.id', 'service_keys.org_id')
        .innerJoin('tenants', 'tenants.id', 'service_keys.tenant_id')
        .select([
            'service_keys.public_key_pem as public_key_pem',
            'service_keys.tenant_id as tenant_id',
            'tenants.slug as tenant_slug',
            'service_keys.org_id as org_id',
            'organizations.slug as org_slug',
        ])
        .where('organizations.slug', '=', orgSlug)
        .where('service_keys.revoked_at', 'is', null)
        .execute()
    return rows.map((r) => ({
        publicKeyPem: r.public_key_pem,
        tenantId: r.tenant_id,
        tenantSlug: r.tenant_slug,
        orgId: r.org_id,
        orgSlug: r.org_slug,
    }))
}
