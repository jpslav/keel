import { Kysely, PostgresDialect, type Transaction } from 'kysely'
import { Pool } from 'pg'
import { migrateToLatest } from '../../db/migrate'
import type { DB } from '../../db/schema'
import { runWithTenant } from '../../db/with-tenant'
import type { DbPort } from '../../ports/db'

/**
 * AUTHORED — CUTOVER (`cloud-accounts`): typechecked, never run against Aurora. The migrator
 * Lambda and the app share this adapter; connection details come from DATABASE_URL (Secrets
 * Manager-injected in deployed environments).
 */
export function createRealDb(databaseUrl: string): DbPort {
    const pool = new Pool({ connectionString: databaseUrl, max: 5 })
    const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) })

    return {
        getDb() {
            return db
        },
        async ready() {
            // Real databases are provisioned/migrated by the deploy pipeline, not lazily.
        },
        async withTenant<T>(tenantId: string, fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
            return runWithTenant(db, tenantId, fn)
        },
        async migrateToLatest() {
            await migrateToLatest(db)
        },
    }
}
