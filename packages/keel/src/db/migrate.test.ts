import { Kysely, sql } from 'kysely'
import { Migrator } from 'kysely/migration'
import { describe, expect, test } from 'vitest'
import { openPglite, PGliteDialect } from '../adapters/fake/pglite-dialect'
import { migrateToLatest } from './migrate'
import { migrations } from './migrations/index'
import type { DB } from './schema'

/**
 * The upgrade path every adopter takes. A database that has run the app's migrations (≥1001) then
 * receives a keel update carrying a NEW framework migration, which sorts before them by name. The
 * fixture seam registers its own ≥1001 migrations, so this is the exact shape of an adopter's database.
 */
describe('migrateToLatest', () => {
    test(
        'applies a framework migration that arrives after app migrations already ran',
        { timeout: 20_000 },
        async () => {
            const names = Object.keys(migrations).sort()
            const latestFramework = names.filter((name) => name < '1000').at(-1)!
            const appNames = names.filter((name) => name >= '1000')
            expect(appNames.length, 'the fixture seam registers app migrations').toBeGreaterThan(0)

            const db = new Kysely<DB>({ dialect: new PGliteDialect(openPglite()) })
            // The database as it stood before the update: everything except the newest framework migration.
            const before = Object.fromEntries(Object.entries(migrations).filter(([name]) => name !== latestFramework))
            const old = await new Migrator({ db, provider: { getMigrations: async () => before } }).migrateToLatest()
            expect(old.error).toBeUndefined()

            await migrateToLatest(db)

            const ran = await sql<{ name: string }>`SELECT name FROM kysely_migration`.execute(db)
            expect(ran.rows.map((row) => row.name).sort()).toEqual(names)
            await db.destroy()
        },
    )
})
