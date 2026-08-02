import type { Kysely, Transaction } from 'kysely'
import type { DB } from '../db/schema'

/**
 * Database port (ADR-0002, ADR-0004). All tenant-scoped access goes through withTenant, which
 * runs fn inside a transaction whose first statements set the app_user role and tenant context —
 * RLS does the enforcement, not query discipline. The raw db handle is for tenant-less tables
 * and infrastructure work only.
 */
export interface DbPort {
    getDb(): Kysely<DB>
    withTenant<T>(tenantId: string, fn: (trx: Transaction<DB>) => Promise<T>): Promise<T>
    /** Resolves once the database is usable (fake: migrated + seeded). Await before raw getDb reads. */
    ready(): Promise<void>
    /** Applies pending migrations (dev boot, tests, and the migrator Lambda all share this). */
    migrateToLatest(): Promise<void>
}
