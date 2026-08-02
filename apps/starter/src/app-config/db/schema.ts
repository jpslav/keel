import type { Generated } from 'kysely'

/**
 * The APP's tenant-scoped tables (the seam side of keel/db/schema.ts, ADR-0012). The framework owns its
 * tables + the `DB` interface, which `extends AppTables` (a type-only seam import). Kept in lockstep
 * with the migrations in ./migrations (numbered ≥1001).
 */

interface ItemsTable {
    id: Generated<string>
    tenant_id: string
    /** The team that owns the item. NOT NULL — an app-level filter, not an RLS anchor (1001). */
    org_id: string
    title: string
    /** Opaque user id (no users table) — same convention as the framework's jobs / service_keys. */
    created_by_user_id: string
    created_at: Generated<string>
}

/** The app's tables, merged into the framework `DB` interface (keel/db/schema.ts `extends AppTables`). */
export interface AppTables {
    items: ItemsTable
}
