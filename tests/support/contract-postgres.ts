import EmbeddedPostgres from 'embedded-postgres'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool } from 'pg'
import type { Login } from 'keel/db/owner-pass'
import type { DB } from 'keel/db/schema'
import { portFor } from '../../scripts/ports.mjs'
import { makeTestTmpDirAsync } from './tmp-dir'

/**
 * A real Postgres for a contract suite, and a database of its own on it. Generic: it names no app, no seam and no
 * migration, so the suite that uses it (contract-suite.ts) runs unchanged for any app, and so does the framework's
 * fixture. It is also where the "embedded-postgres or CI's service container" decision lives, once.
 *
 * WHY EVERY SUITE NEEDS A DATABASE OF ITS OWN. Two migration sets share the framework's 0001-0999 and differ from
 * 1001 up, so running the second set's `migrateToLatest` over a database the first has migrated makes Kysely report
 * corrupted migrations. One server, one database per suite (`<slug>_contract`, `keel_contract`), is how every
 * app's per-app migrations meet real Postgres without meeting each other's.
 *
 * Two modes, picked by the environment and the same for every caller:
 *  - CONTRACT_DATABASE_URL set (CI): that server, which several suites share, each in its own database. The URL
 *    must be a SUPERUSER's, to a database that already exists (`postgres`).
 *  - unset (a developer's machine): an embedded-postgres of the suite's own, on the port derived per checkout
 *    (scripts/ports.mjs `contractPg`), stopped when the suite ends. `vitest.contract.config.ts` runs files one at
 *    a time, so two never hold that port together.
 */

export interface ContractServer {
    /** The server's SUPERUSER URL, to its maintenance database. */
    readonly url: string
    /** The superuser's login, as the owner pass and the proofs take it. */
    readonly superuser: { user: string; password: string }
    /** A database that already exists on the server (the one `url` names). */
    readonly maintenanceDatabase: string
    /** A pooled connection for a login to a database, through `pg`. Closed by its caller, or by `stop`. */
    connect(login: Login): Kysely<DB>
    /** The superuser's connection to `database`. */
    connectAsSuperuser(database: string): Kysely<DB>
    /** `CREATE DATABASE`, tolerating one that is already there (a reused live server). */
    createDatabase(database: string): Promise<void>
    /** Drops a database if it is there and creates it again, empty: for a suite that must start from nothing. */
    recreateDatabase(database: string): Promise<void>
    /** Closes every connection still open, then stops the embedded server (a no-op for an external one). */
    stop(): Promise<void>
}

/**
 * The database name a suite uses for an app: `<slug>_contract`, the slug folded to what an unquoted Postgres
 * identifier may hold. `acme-corp` becomes `acme_corp_contract`, so an app renamed by `pnpm init-app` gets its own
 * name with no edit here.
 */
export function contractDatabaseName(slug: string): string {
    // 63 is Postgres's identifier limit; "_contract" is 9 of it.
    const folded = slug
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 50)
    const base = /^[a-z]/.test(folded) ? folded : `app_${folded}`
    return `${base}_contract`
}

/** The name goes into an identifier. It is built by contractDatabaseName or is a fixed literal, never client input, but
 *  it is still held to the shape an unquoted identifier has. */
function checkedName(database: string): string {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(database)) throw new Error(`invalid contract database name: ${database}`)
    return database
}

export async function startContractServer(label: string): Promise<ContractServer> {
    let embedded: InstanceType<typeof EmbeddedPostgres> | null = null
    let serverUrl = process.env.CONTRACT_DATABASE_URL ?? ''
    if (!serverUrl) {
        const port = portFor('contractPg')
        embedded = new EmbeddedPostgres({
            databaseDir: await makeTestTmpDirAsync(`${label}-pg-`),
            user: 'postgres',
            password: 'postgres',
            port,
            persistent: false,
        })
        await embedded.initialise()
        await embedded.start()
        serverUrl = `postgres://postgres:postgres@localhost:${port}/postgres`
    }

    const parsed = new URL(serverUrl)
    const superuser = { user: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password) }
    const maintenanceDatabase = parsed.pathname.slice(1) || 'postgres'
    const open: Kysely<DB>[] = []

    const connect = (login: Login): Kysely<DB> => {
        const url = new URL(serverUrl)
        url.username = encodeURIComponent(login.user)
        url.password = encodeURIComponent(login.password)
        url.pathname = `/${login.database}`
        const pool = new Pool({ connectionString: url.toString(), max: 3 })
        // A server that ends a connection (a CI container's hiccup, an idle-session timeout) is an 'error' EVENT on
        // that client, and an event with no listener is an uncaught exception: it would take the whole run down
        // instead of failing the one test that was using the connection. The client's own listener covers it idle
        // or checked out, as in the real adapter (keel/adapters/real/db.ts); the pool's re-emit of an idle one is
        // already logged by it.
        pool.on('connect', (client) => client.on('error', (error) => console.warn(`contract db: ${error.message}`)))
        pool.on('error', () => undefined)
        const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) })
        open.push(db)
        return db
    }

    return {
        url: serverUrl,
        superuser,
        maintenanceDatabase,
        connect,
        connectAsSuperuser: (database) => connect({ ...superuser, database }),
        async createDatabase(database) {
            const admin = connect({ ...superuser, database: maintenanceDatabase })
            try {
                await sql`CREATE DATABASE ${sql.id(checkedName(database))}`.execute(admin)
            } catch (error) {
                // A reused live server already has it; the proofs stamp their own rows, so that is fine.
                if (!/already exists/.test(String(error))) throw error
            } finally {
                await admin.destroy()
            }
        },
        async recreateDatabase(database) {
            const admin = connect({ ...superuser, database: maintenanceDatabase })
            try {
                await sql`DROP DATABASE IF EXISTS ${sql.id(checkedName(database))} WITH (FORCE)`.execute(admin)
                await sql`CREATE DATABASE ${sql.id(database)}`.execute(admin)
            } finally {
                await admin.destroy()
            }
        },
        async stop() {
            await Promise.all(open.map((db) => db.destroy().catch(() => undefined)))
            await embedded?.stop()
        },
    }
}
