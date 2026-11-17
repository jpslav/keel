import type { DbPort } from '../ports/db'

/**
 * Resolves an org slug (what sessions carry) to its uuid, scoped to the tenant it belongs to. Reads
 * the RLS-free `organizations` infra table — the same legitimate raw read as tenant-lookup. Org slugs
 * are unique per tenant, so the tenant scope keeps the lookup unambiguous even if two tenants ever
 * reuse a slug.
 */
export async function orgIdForSlug(db: DbPort, tenantId: string, orgSlug: string): Promise<string | null> {
    // Cold-start guard: the fake db migrates+seeds lazily; don't read before that completes.
    await db.ready()
    const row = await db
        .getDb()
        .selectFrom('organizations')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('slug', '=', orgSlug)
        .executeTakeFirst()
    return row?.id ?? null
}

/** The brand only this module writes: a value of {@link OrgIdentity} came from {@link orgIdentityForSlug}. */
declare const fromOneRow: unique symbol

/**
 * An org's uuid AND slug, read together from ONE `organizations` row. `abilityActorFromCredential` reads a
 * person's standing by slug (the auth port names orgs that way) and applies it to the id every sameOrg
 * check compares, so a pair taken from two places could carry one org's role into another's.
 *
 * BRANDED: {@link orgIdentityForSlug} is the only producer, so a hand-paired `{ id, slug }` literal does
 * not compile where one is expected. (A test may cast one; an app that casts has chosen to.)
 */
export interface OrgIdentity {
    readonly id: string
    readonly slug: string
    readonly [fromOneRow]: true
}

/** {@link OrgIdentity} for a slug within a tenant, from one row; null when the tenant has no such org. */
export async function orgIdentityForSlug(db: DbPort, tenantId: string, orgSlug: string): Promise<OrgIdentity | null> {
    await db.ready()
    const row = await db
        .getDb()
        .selectFrom('organizations')
        .select(['id', 'slug'])
        .where('tenant_id', '=', tenantId)
        .where('slug', '=', orgSlug)
        .executeTakeFirst()
    return row ? ({ id: row.id, slug: row.slug } as OrgIdentity) : null
}

/**
 * Resolves an org uuid back to its slug + name — the reverse of orgIdForSlug, same RLS-free raw read.
 * Used by the scheduled digest handler, which knows its job's org_id but needs the slug to
 * find recipients (@app/seed people) and the name for the digest copy. Null when the org is gone.
 */
export async function orgForId(db: DbPort, orgId: string): Promise<{ slug: string; name: string } | null> {
    await db.ready()
    const row = await db
        .getDb()
        .selectFrom('organizations')
        .select(['slug', 'name'])
        .where('id', '=', orgId)
        .executeTakeFirst()
    return row ?? null
}

/**
 * Every org across ALL tenants, joined to its tenant slug — the Simulator's inbound compose picker.
 * A raw cross-tenant read (the listSchedulesForWorld / listOrgsInTenant precedent), reaching past
 * the tenant RLS scope on purpose; the route gates it to simulated mode.
 */
export async function listOrgsForWorld(db: DbPort): Promise<{ slug: string; name: string; tenantSlug: string }[]> {
    await db.ready()
    const rows = await db
        .getDb()
        .selectFrom('organizations')
        .innerJoin('tenants', 'tenants.id', 'organizations.tenant_id')
        .select(['organizations.slug as slug', 'organizations.name as name', 'tenants.slug as tenant_slug'])
        .orderBy('tenants.slug', 'asc')
        .orderBy('organizations.name', 'asc')
        .execute()
    return rows.map((r) => ({ slug: r.slug, name: r.name, tenantSlug: r.tenant_slug }))
}

/**
 * All orgs (teams) in one tenant, for the cross-org request target picker. Reads the RLS-free
 * `organizations` infra table — the same legitimate raw read as orgIdForSlug — so it lists every team
 * in the caller's tenant regardless of which one they're acting in. The route strips the active org
 * from the result (you don't request from yourself); the table CHECK is the backstop.
 */
export async function listOrgsInTenant(
    db: DbPort,
    tenantId: string,
): Promise<{ id: string; slug: string; name: string }[]> {
    await db.ready()
    return db
        .getDb()
        .selectFrom('organizations')
        .select(['id', 'slug', 'name'])
        .where('tenant_id', '=', tenantId)
        .orderBy('name', 'asc')
        .execute()
}
