import { appMigrations } from '@app-config/db/migrations'
import { Kysely, sql } from 'kysely'
import { Migrator } from 'kysely/migration'
import { describe, expect, test } from 'vitest'
import { openPglite, PGliteDialect } from '../adapters/fake/pglite-dialect'
import { migrateToLatest } from './migrate'
import { frameworkMigrations, migrations } from './migrations/index'
import type { DB } from './schema'

/**
 * The upgrade path every adopter takes, and the numbering that makes it safe. Framework migrations
 * (0001–0999) and the app's (≥1001) are two sequences interleaved by name, so a NEW framework migration
 * arriving in a keel update sorts BEFORE app migrations the database already ran. A seam-conformance
 * test: it runs against keel's fixture seam AND every app's, since the hazard is in how the two compose.
 */

const prefix = (name: string): number => Number(/^(\d{4})_/.exec(name)?.[1] ?? Number.NaN)

/** The parts of a schema a migration can change and that must not depend on the order it ran in. */
async function schemaOf(db: Kysely<DB>) {
    const columns = await sql`
        SELECT table_name, column_name, data_type, is_nullable, column_default
        FROM information_schema.columns WHERE table_schema = 'public'
        ORDER BY table_name, column_name`.execute(db)
    const policies = await sql`
        SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
        WHERE schemaname = 'public' ORDER BY tablename, policyname`.execute(db)
    const grants = await sql`
        SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'app_user' ORDER BY table_name, privilege_type`.execute(db)
    const indexes = await sql`
        SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`.execute(db)
    return { columns: columns.rows, policies: policies.rows, grants: grants.rows, indexes: indexes.rows }
}

describe('migration numbering', () => {
    test('every app migration is numbered ≥1001 and none shares a name with a framework one', () => {
        const app = Object.keys(appMigrations)
        expect(app.length, 'the seam registers at least one app migration').toBeGreaterThan(0)
        for (const name of app) expect(prefix(name), name).toBeGreaterThanOrEqual(1001)
        for (const name of Object.keys(frameworkMigrations)) expect(prefix(name), name).toBeLessThan(1000)
        // A collision would let the app's key silently replace the framework's in the merged map.
        expect(app.filter((name) => Object.hasOwn(frameworkMigrations, name))).toEqual([])
    })
})

describe('migrateToLatest', () => {
    test(
        'applies a framework migration that arrives after app migrations already ran, to the same schema as a fresh database',
        { timeout: 30_000 },
        async () => {
            const latestFramework = Object.keys(frameworkMigrations).sort().at(-1)!

            // The database as it stood before the update: every migration except the newest framework one.
            const upgraded = new Kysely<DB>({ dialect: new PGliteDialect(openPglite()) })
            const before = Object.fromEntries(Object.entries(migrations).filter(([name]) => name !== latestFramework))
            const old = await new Migrator({
                db: upgraded,
                provider: { getMigrations: async () => before },
            }).migrateToLatest()
            expect(old.error).toBeUndefined()

            await migrateToLatest(upgraded)
            const ran = await sql<{ name: string }>`SELECT name FROM kysely_migration`.execute(upgraded)
            expect(ran.rows.map((row) => row.name).sort()).toEqual(Object.keys(migrations).sort())

            // ...and it ended up where a database migrated from empty does, whatever order got it there.
            const fresh = new Kysely<DB>({ dialect: new PGliteDialect(openPglite()) })
            await migrateToLatest(fresh)
            expect(await schemaOf(upgraded)).toEqual(await schemaOf(fresh))

            await upgraded.destroy()
            await fresh.destroy()
        },
    )
})
