import { Kysely, sql, Transaction } from 'kysely'
import type { DB } from './schema.js'

/**
 * Prototype of the app-wide tenant scope helper (promoted into the db adapter in the tenancy phase).
 *
 * SET takes no bind parameters, so the role statement is static SQL and the tenant id goes through
 * set_config() as a real parameter — never string interpolation. SET LOCAL ROLE is required under
 * pglite, whose default user is a BYPASSRLS superuser; it is also what production uses, and being
 * transaction-scoped it is safe under connection pooling.
 */
export async function withTenant<T>(
    db: Kysely<DB>,
    tenantId: string,
    fn: (trx: Transaction<DB>) => Promise<T>,
): Promise<T> {
    return db.transaction().execute(async (trx) => {
        await sql`SET LOCAL ROLE app_user`.execute(trx)
        await sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`.execute(trx)
        return fn(trx)
    })
}
