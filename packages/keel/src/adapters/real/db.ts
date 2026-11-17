import { RDSDataClient } from '@aws-sdk/client-rds-data'
import { Kysely, PostgresDialect, type Transaction } from 'kysely'
import { Pool, types, type CustomTypesConfig } from 'pg'
import { migrateToLatest } from '../../db/migrate'
import type { DB } from '../../db/schema'
import { runWithTenant } from '../../db/with-tenant'
import type { DbPort } from '../../ports/db'
import { RdsDataDialect, type RdsDataClientLike } from './rds-data-dialect'

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
 * Manager-injected in deployed environments). This is the default driver (`DATABASE_DRIVER=pg`), for a
 * Lambda that runs inside the database's VPC.
 */
export function createRealDb(databaseUrl: string): DbPort {
    const pool = new Pool({ connectionString: databaseUrl, max: 5, types: pgTypes })
    return dbPortFor(new Kysely<DB>({ dialect: new PostgresDialect({ pool }) }))
}

export interface DataApiDbConfig {
    /** The Aurora cluster's ARN; the cluster must have the Data API enabled. */
    resourceArn: string
    /** The Secrets Manager secret holding the database credentials the Data API connects with. */
    secretArn: string
    database: string
    /** Omitted: the SDK's own region resolution (AWS_REGION in Lambda). */
    region?: string
    /** Injected only by the contract suite, which runs the dialect against its emulator. */
    client?: RdsDataClientLike
}

/**
 * The second real driver (`DATABASE_DRIVER=data-api`): the same port over the RDS Data API, for a
 * Lambda outside any VPC — no NAT, no socket, IAM instead of a network path (ADR-0002, addendum
 * 2026-11-16). AUTHORED — CUTOVER (`data-api`).
 *
 * `maxAttempts: 1` turns the SDK's automatic retries off, on AWS's own advice: a statement whose call
 * timed out may still have finished, and retrying it can write twice. The one failure that is safe to
 * retry (a paused Serverless v2 resuming) is retried by the dialect itself.
 */
export function createRealDataApiDb(config: DataApiDbConfig): DbPort {
    const client = config.client ?? new RDSDataClient({ region: config.region, maxAttempts: 1 })
    const dialect = new RdsDataDialect({
        client,
        resourceArn: config.resourceArn,
        secretArn: config.secretArn,
        database: config.database,
    })
    return dbPortFor(new Kysely<DB>({ dialect }))
}

/** One port shape for both drivers: they differ in how SQL reaches Postgres, never in what it says. */
function dbPortFor(db: Kysely<DB>): DbPort {
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
