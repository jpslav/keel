import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { migrateToLatest } from 'keel/db/migrate'
import { runRlsProofs } from 'keel/db/rls-proof-runner'
import type { DB } from 'keel/db/schema'
import { portFor } from '../../../../scripts/ports.mjs'

/**
 * The "fakes can't drift" job: the SAME migrations + RLS proof suite that runs on pglite in unit
 * tests, executed against REAL Postgres. Locally that's embedded-postgres binaries (no docker on
 * the dev VM); in CI, set CONTRACT_DATABASE_URL to a postgres service container instead.
 *
 * Run via `pnpm test:contract` — deliberately not part of the fast unit suite.
 */

const externalUrl = process.env.CONTRACT_DATABASE_URL

let embedded: InstanceType<typeof EmbeddedPostgres> | null = null
let db: Kysely<DB>

beforeAll(async () => {
    let connectionString = externalUrl
    if (!connectionString) {
        // Derived per checkout (scripts/ports.mjs), so two worktrees can run `pnpm test:contract`
        // at once instead of the second one failing to bind.
        const port = portFor('contractPg')
        embedded = new EmbeddedPostgres({
            databaseDir: mkdtempSync(path.join(tmpdir(), 'app-contract-pg-')),
            user: 'postgres',
            password: 'postgres',
            port,
            persistent: false,
        })
        await embedded.initialise()
        await embedded.start()
        await embedded.createDatabase('app_contract')
        connectionString = `postgres://postgres:postgres@localhost:${port}/app_contract`
    }
    db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString, max: 3 }) }) })
    await migrateToLatest(db)
}, 120_000)

afterAll(async () => {
    await db?.destroy()
    await embedded?.stop()
})

describe('tenant isolation on real Postgres (contract)', () => {
    test('the full RLS proof suite passes', async () => {
        await runRlsProofs(db, expect)
    })
})
