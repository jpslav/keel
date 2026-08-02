import { PGlite } from '@electric-sql/pglite'
import { Kysely } from 'kysely'
import { describe, expect, test } from 'vitest'
import { PGliteDialect } from '../adapters/fake/pglite-dialect'
import { migrateToLatest } from './migrate'
import { runRlsProofs } from './rls-proof-runner'
import type { DB } from './schema'

describe('tenant isolation on pglite (framework + app migrations)', () => {
    test('the full RLS proof suite passes', { timeout: 20_000 }, async () => {
        const db = new Kysely<DB>({ dialect: new PGliteDialect(new PGlite()) })
        await migrateToLatest(db)
        await runRlsProofs(db, expect)
        await db.destroy()
    })
})
