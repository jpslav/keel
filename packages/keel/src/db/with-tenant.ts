import { sql, type Kysely, type Transaction } from 'kysely'
import type { DB } from './schema'

/**
 * The tenant scope helper every db transport shares (proven in spikes/kysely-pglite; ADR-0004).
 *
 * ONE statement sets both halves of the scope, transaction-locally: `set_config('role', 'app_user', true)`
 * is `SET LOCAL ROLE app_user` (same GUC, same membership check) and the tenant id goes through
 * set_config() as a real parameter — never string interpolation. One statement rather than two because
 * on the RDS Data API every statement is its own HTTPS call (ADR-0004, addendum 2026-11-16); on `pg` and
 * pglite it is simply one round trip fewer. Transaction-scoped, so it is safe under pooling, required
 * under pglite (whose default user bypasses RLS), and the only shape that survives the Data API's
 * connection reset between transactions.
 */
export async function runWithTenant<T>(
    db: Kysely<DB>,
    tenantId: string,
    fn: (trx: Transaction<DB>) => Promise<T>,
): Promise<T> {
    return db.transaction().execute(async (trx) => {
        await sql`SELECT set_config('role', 'app_user', true), set_config('app.current_tenant', ${tenantId}, true)`.execute(
            trx,
        )
        return fn(trx)
    })
}
