import type { Generated } from 'kysely'

/**
 * The APP's tenant-scoped tables (the seam side of keel/db/schema.ts, ADR-0012). The framework owns its
 * tables + the `DB` interface, which `extends AppTables` (a type-only seam import). Kept in lockstep
 * with the migrations in ./migrations (numbered ≥1001).
 */

/**
 * `dockets` — the fixture's one product table. It exists so keel's suite has an APP table to prove the
 * app half of the seam against: the RLS proofs isolate it, the `export-dockets` job handler reads it
 * and writes an artifact, and the `support` inbound-email handler writes to it.
 */
interface DocketsTable {
    id: Generated<string>
    tenant_id: string
    /** The team that owns the docket. NOT NULL — an app-level filter, not an RLS anchor (1001). */
    org_id: string
    /** The docket's one-line title (an inbound email's Subject becomes this). */
    label: string
    body: string
    /** open | closed — a plain string column, since the fixture registers no state machine for it. */
    status: Generated<string>
    /** Opaque user id (no users table) — same convention as the framework's jobs / service_keys. */
    created_by_user_id: string
    created_at: Generated<string>
}

/** The app's tables, merged into the framework `DB` interface (keel/db/schema.ts `extends AppTables`). */
export interface AppTables {
    dockets: DocketsTable
}
