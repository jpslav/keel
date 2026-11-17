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
    /**
     * The instant to stamp on a row whose time the FRAMEWORK writes (today only the audit trail's `at`,
     * `recordAuditEvent`), when the database's own clock is not the world's.
     *
     * The fake database sets it to the Simulator's world clock, so a demo that advances time sees new events
     * dated in that time. A real adapter must leave it undefined: Postgres `now()` is then the only clock, and
     * nothing a caller passes can set an audit row's time. It is a property of the PORT, not an argument of
     * `recordAuditEvent`, for exactly that reason: there is no `at` for a route to supply or forge.
     */
    now?(): Date
}
