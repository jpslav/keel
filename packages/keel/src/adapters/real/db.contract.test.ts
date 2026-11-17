import EmbeddedPostgres from 'embedded-postgres'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { portFor } from '../../../../../scripts/ports.mjs'
import { makeTestTmpDir } from '../../../../../tests/support/tmp-dir'
import { runOwnerPass } from '../../db/owner-pass'
import { runRlsProofs } from '../../db/rls-proof-runner'
import type { DbPort } from '../../ports/db'
import { createRealDb } from './db'

/**
 * keel's OWN contract run: the composed proof suite over the framework's fixture seam
 * (packages/keel/test-fixture), on real Postgres, through the REAL db adapter — so what is proven is the
 * pool configuration production runs (its `date` parser included), not a hand-built one.
 *
 * It needs its own database. The fixture's migrations share 0001–0999 with the contract app's but differ
 * from 1001 up, and two such sets over one database make Kysely report corrupted migrations. So it
 * creates `keel_contract` on whichever server it is given: CONTRACT_DATABASE_URL's in CI, otherwise an
 * embedded-postgres of its own on the same derived port as the app harness — `vitest.contract.config.ts`
 * runs files one at a time, so the two never hold that port together.
 */

const DATABASE = 'keel_contract'

let embedded: InstanceType<typeof EmbeddedPostgres> | null = null
let realDb: DbPort
/** The server's superuser URL (to its `postgres` database), kept for the non-superuser pass. */
let serverUrl: string

beforeAll(async () => {
    serverUrl = process.env.CONTRACT_DATABASE_URL ?? ''
    if (!serverUrl) {
        const port = portFor('contractPg')
        embedded = new EmbeddedPostgres({
            databaseDir: makeTestTmpDir('keel-contract-pg-'),
            user: 'postgres',
            password: 'postgres',
            port,
            persistent: false,
        })
        await embedded.initialise()
        await embedded.start()
        serverUrl = `postgres://postgres:postgres@localhost:${port}/postgres`
    }

    const server = createRealDb(serverUrl).getDb()
    try {
        await sql`CREATE DATABASE ${sql.id(DATABASE)}`.execute(server)
    } catch (error) {
        // A reused live server already has it; the proofs stamp their own rows, so that is fine.
        if (!/already exists/.test(String(error))) throw error
    } finally {
        await server.destroy()
    }

    const url = new URL(serverUrl)
    url.pathname = `/${DATABASE}`
    realDb = createRealDb(url.toString())
    await realDb.migrateToLatest()
}, 120_000)

afterAll(async () => {
    await realDb?.getDb().destroy()
    await embedded?.stop()
})

/** A connection for a login on this server, through the REAL adapter (its pool, its `date` parser). */
function connect(login: { database: string; user: string; password: string }) {
    const url = new URL(serverUrl)
    url.username = encodeURIComponent(login.user)
    url.password = encodeURIComponent(login.password)
    url.pathname = `/${login.database}`
    return createRealDb(url.toString()).getDb()
}

describe('keel fixture seam on real Postgres, through the real adapter (contract)', () => {
    test('the full RLS proof suite passes', async () => {
        await runRlsProofs(realDb.getDb(), expect)
    })

    // The pass every other one cannot be: a NON-SUPERUSER owner, as Aurora's master user is, runs the
    // migrations and makes every role switch in the proofs (packages/keel/src/db/owner-pass.ts).
    test('a non-superuser owner migrates, and switches to app_user inside withTenant', async () => {
        const server = new URL(serverUrl)
        const admin = connect({
            database: server.pathname.slice(1) || 'postgres',
            user: decodeURIComponent(server.username),
            password: decodeURIComponent(server.password),
        })
        try {
            await runOwnerPass(
                {
                    admin,
                    superuser: {
                        user: decodeURIComponent(server.username),
                        password: decodeURIComponent(server.password),
                    },
                    maintenanceDatabase: server.pathname.slice(1) || 'postgres',
                    connect,
                },
                expect,
            )
        } finally {
            await admin.destroy()
        }
    })
})
