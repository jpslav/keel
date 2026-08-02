import type { DbPort } from '../ports/db'

/**
 * Resolves a tenant slug (what sessions carry) to its uuid (what RLS scopes by). Reads the
 * tenant-less `tenants` infra table — the one legitimate raw-db read in request paths.
 */
export async function tenantIdForSlug(db: DbPort, slug: string): Promise<string | null> {
    // Cold-start guard: the fake db migrates+seeds lazily; don't read
    // the tenants table before that completes.
    await db.ready()
    const row = await db.getDb().selectFrom('tenants').select('id').where('slug', '=', slug).executeTakeFirst()
    return row?.id ?? null
}
