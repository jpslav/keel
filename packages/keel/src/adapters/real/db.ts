import { Kysely, PostgresDialect, type Transaction } from 'kysely'
import { Pool, types, type CustomTypesConfig } from 'pg'
import { migrateToLatest } from '../../db/migrate'
import type { DB } from '../../db/schema'
import { runWithTenant } from '../../db/with-tenant'
import type { DbPort } from '../../ports/db'

/**
 * A Postgres `date` is a calendar day — no time, no zone — and it reaches application code as the wire
 * string (`'2026-10-03'`), never a JS `Date`. `pg`'s default parser builds `new Date(y, m, d)`: LOCAL
 * midnight in whatever zone the server process runs in, which east of UTC is still the previous day
 * once read back as UTC. There is no zone-safe `Date` to build from a value that was never an instant,
 * so none is built. The schema types every `date` column as `string`, and this is what makes that true.
 *
 * `date[]` is parsed as a text array, so an array of days is an array of strings (its own default
 * rebuilds each element with the same local-midnight `Date`). The fake adapter configures pglite
 * identically (`openPglite`, ../fake/pglite-dialect.ts), and the fixture's `due_on` proof pins both.
 *
 * Scoped to THIS adapter's pool rather than `types.setTypeParser`, which would rewrite the parser for
 * every `pg` client in the process, from whichever module happened to be imported first.
 */
type Oid = Parameters<typeof types.getTypeParser>[0]
// pg-types' `TypeId` enum names scalar types only, so the two array OIDs are cast into it.
const DATE_ARRAY_OID = 1182 as Oid
const TEXT_ARRAY_OID = 1009 as Oid
const pgTypes: CustomTypesConfig = {
    getTypeParser: (oid, format = 'text') => {
        if (format === 'text' && oid === types.builtins.DATE) return (value: string) => value
        if (format === 'text' && oid === DATE_ARRAY_OID) return types.getTypeParser(TEXT_ARRAY_OID, format)
        return types.getTypeParser(oid, format)
    },
}

/**
 * AUTHORED — CUTOVER (`cloud-accounts`): typechecked, never run against Aurora. The migrator
 * Lambda and the app share this adapter; connection details come from DATABASE_URL (Secrets
 * Manager-injected in deployed environments). This is the default transport (`DATABASE_TRANSPORT=pg`),
 * for a Lambda inside the database's VPC; the RDS Data API one is ./db-data-api.ts.
 */
export function createRealDb(databaseUrl: string): DbPort {
    const pool = new Pool({ connectionString: databaseUrl, max: 5, types: pgTypes })
    pool.on('error', logIdleConnectionError)
    return dbPortFor(new Kysely<DB>({ dialect: new PostgresDialect({ pool }) }))
}

/**
 * An IDLE pooled connection the server ended: Aurora does it when a Serverless v2 cluster pauses at
 * min capacity 0, on a failover, and at an idle timeout. pg-pool reports that as an 'error' event on the
 * pool and drops the client, and the next query opens a fresh one. With no listener the event is an
 * uncaught exception, which crashes the Lambda between requests. So it is logged and nothing else: no
 * query was running on that connection, and a connection that IS in use fails its own query as before.
 *
 * Logged with `console.warn`, which reaches CloudWatch in Lambda. keel has no logger port, and Sentry is
 * loaded only when a DSN is configured (../sentry/init.ts), so the adapter does not import it. pg's error
 * message and code (57P01 for "terminating connection due to administrator command") carry no
 * credentials. The Data API transport has no such pool: it speaks HTTPS through the SDK, whose failures
 * reject the call that made them.
 */
function logIdleConnectionError(error: Error & { code?: string }): void {
    console.warn(
        `keel db: an idle pooled connection ended (${error.code ?? 'no code'}: ${error.message}); the pool replaces it`,
    )
}

/** One port shape for both transports: they differ in how SQL reaches Postgres, never in what it says. */
export function dbPortFor(db: Kysely<DB>): DbPort {
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
