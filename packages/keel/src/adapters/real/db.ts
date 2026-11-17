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
    // Every client gets its own listener as it connects, for its whole life, idle or checked out.
    pool.on('connect', (client) => client.on('error', logConnectionError))
    // pg-pool re-emits an IDLE client's error on the pool. The client's listener above has logged it, and
    // any other error the pool emits (a failed connect, a client being removed) has already reached the
    // caller that asked for it, so this listener exists only so the event is not an uncaught exception.
    pool.on('error', () => undefined)
    return dbPortFor(new Kysely<DB>({ dialect: new PostgresDialect({ pool }) }))
}

/**
 * A pooled connection the server ended: a failover, a reboot, an idle-session timeout, a socket dropped
 * while the Lambda sat frozen between invocations. pg reports it as an 'error' EVENT on the client, and an
 * event with no listener is an uncaught exception, which crashes the process: between requests if the
 * connection was idle, in the middle of one if a transaction held it. pg-pool listens to idle clients only,
 * and Kysely adds no listener to the client it checks out, which it does for every transaction, every
 * `withTenant` and the migrator's run. So every client gets this listener. If a query or transaction was
 * using the connection, that query fails with its own error as usual. Either way, the pool drops the dead
 * client and the next query opens a fresh one.
 *
 * Logged with `console.warn`, which reaches CloudWatch in Lambda. keel has no logger port, and Sentry is
 * loaded only when a DSN is configured (../sentry/init.ts), so the adapter does not import it. Only the
 * error's code and message are logged (57P01 is "terminating connection due to administrator command").
 * They carry no credentials, unlike the error object itself, whose `client` holds the password. The Data
 * API transport has no such pool: it speaks HTTPS through the SDK, whose failures reject the call that
 * made them.
 */
function logConnectionError(error: Error & { code?: string }): void {
    console.warn(`keel db: a pooled database connection ended (${error.code ?? 'no code'}: ${error.message})`)
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
