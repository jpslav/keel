import { sql, type Kysely, type Transaction } from 'kysely'
import type { DB } from './schema'

/**
 * The tenant scope helper both db adapters share (proven in spikes/kysely-pglite; ADR-0004).
 * SET takes no bind parameters, so the role statement is static SQL and the tenant id goes
 * through set_config() as a real parameter — never string interpolation. Transaction-scoped,
 * so it is safe under pooling and required under pglite (whose default user bypasses RLS).
 */
export async function runWithTenant<T>(
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
