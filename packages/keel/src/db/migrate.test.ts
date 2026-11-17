import { appMigrations } from '@app-config/db/migrations'
import { Kysely, sql } from 'kysely'
import { type Migration, Migrator } from 'kysely/migration'
import { describe, expect, test } from 'vitest'
import { openPglite, PGliteDialect } from '../adapters/fake/pglite-dialect'
import { migrateRegistryToLatest, migrateToLatest, outOfSequence } from './migrate'
import { frameworkMigrations, migrations } from './migrations/index'
import type { DB } from './schema'

/**
 * The upgrade path every adopter takes, and the numbering that makes it safe. Framework migrations
 * (0001–0999) and the app's (≥1001) are two sequences interleaved by name, so a NEW framework migration
 * arriving in a keel update sorts BEFORE app migrations the database already ran. A seam-conformance
 * test: it runs against keel's fixture seam AND every app's, since the hazard is in how the two compose.
 */

const prefix = (name: string): number => Number(/^(\d{4})_/.exec(name)?.[1] ?? Number.NaN)

/**
 * The parts of a schema a migration can change and that must not depend on the order it ran in: above
 * all, the tenancy machinery (RLS enabled and FORCED per table, its policies and their roles, app_user's
 * grants down to the column), then shape (columns, constraints, indexes) and code (triggers, functions).
 */
async function schemaOf(db: Kysely<DB>) {
    const rows = async (query: ReturnType<typeof sql>) => (await query.execute(db)).rows
    return {
        rls: await rows(sql`
            SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`),
        policies: await rows(sql`
            SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies
            WHERE schemaname = 'public' ORDER BY tablename, policyname`),
        tableGrants: await rows(sql`
            SELECT table_name, privilege_type FROM information_schema.role_table_grants
            WHERE grantee = 'app_user' ORDER BY table_name, privilege_type`),
        columnGrants: await rows(sql`
            SELECT table_name, column_name, privilege_type FROM information_schema.column_privileges
            WHERE grantee = 'app_user' ORDER BY table_name, column_name, privilege_type`),
        columns: await rows(sql`
            SELECT table_name, column_name, data_type, is_nullable, column_default
            FROM information_schema.columns WHERE table_schema = 'public'
            ORDER BY table_name, column_name`),
        constraints: await rows(sql`
            SELECT conrelid::regclass::text AS table_name, conname, pg_get_constraintdef(oid) AS definition
            FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`),
        indexes: await rows(sql`
            SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`),
        triggers: await rows(sql`
            SELECT event_object_table, trigger_name, event_manipulation, action_timing, action_statement
            FROM information_schema.triggers WHERE trigger_schema = 'public' ORDER BY 1, 2, 3`),
        // Role memberships in app_user: what a migration like 0015 changes, and what withTenant relies on.
        memberships: await rows(sql`
            SELECT m.member::regrole::text AS member, m.admin_option, m.inherit_option, m.set_option
            FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
            WHERE r.rolname = 'app_user' ORDER BY 1, 2, 3, 4`),
        functions: await rows(sql`
            SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' ORDER BY 1, 2`),
    }
}

/**
 * The database as it stood BEFORE the keel update that brings `withheld` (the newest framework migration):
 * the registry minus `withheld`, applied one migration at a time, stopping at the first APP migration
 * that cannot run without it. That migration, and everything after it, arrive with the update and are
 * pending alongside `withheld`, which is how an app migration that builds on a new framework migration
 * reaches a real database. A FRAMEWORK migration failing here is a real defect, and the test fails.
 */
async function buildPreUpdate(
    db: Kysely<DB>,
    registry: Record<string, Migration>,
    withheld: string,
): Promise<string[]> {
    const before = Object.fromEntries(Object.entries(registry).filter(([name]) => name !== withheld))
    const migrator = new Migrator({ db, provider: { getMigrations: async () => before } })
    const ran: string[] = []
    for (;;) {
        const { error, results = [] } = await migrator.migrateUp()
        if (error) {
            // Only an APP migration's own failure ends the build. A framework migration failing, or an
            // error no migration owns (Kysely's own), is a real defect.
            const failed = results.find((result) => result.status === 'Error')?.migrationName
            if (failed === undefined || prefix(failed) < 1000) throw error
            return ran
        }
        if (results.length === 0) return ran
        ran.push(...results.map((result) => result.migrationName))
    }
}

/** A migration from raw SQL, for the synthetic registry below. */
const step = (statement: string): Migration => ({ up: async (db) => void (await sql.raw(statement).execute(db)) })

describe('migration numbering', () => {
    test('every app migration is numbered ≥1001 and none shares a name with a framework one', () => {
        // An app may register no migrations at all (ADR-0004's addendum allows an app with no tables).
        const app = Object.keys(appMigrations)
        for (const name of app) expect(prefix(name), name).toBeGreaterThanOrEqual(1001)
        for (const name of Object.keys(frameworkMigrations)) expect(prefix(name), name).toBeLessThan(1000)
        // A collision would let the app's key silently replace the framework's in the merged map.
        expect(app.filter((name) => Object.hasOwn(frameworkMigrations, name))).toEqual([])
    })
})

describe('outOfSequence', () => {
    test('lets a framework migration run after app migrations, and nothing else out of order', () => {
        const executed = ['0001_a', '0013_b', '1001_c', '1006_f']
        expect(outOfSequence(executed, ['0014_new'])).toEqual([])
        expect(outOfSequence(executed, ['1007_g'])).toEqual([])
        // An app migration that sorts before an app migration already applied (two branches' 1005/1006).
        expect(outOfSequence(executed, ['1005_e', '1007_g'])).toEqual(['1005_e'])
        // A framework migration that sorts before one already applied: a renumbered or late framework one.
        expect(outOfSequence(executed, ['0012_late'])).toEqual(['0012_late'])
    })
})

describe('migrateToLatest', () => {
    test(
        'applies a framework migration that arrives after app migrations already ran, to the same schema as a fresh database',
        { timeout: 30_000 },
        async () => {
            const latestFramework = Object.keys(frameworkMigrations).sort().at(-1)!

            // The database as it stood before the update that brings the newest framework migration.
            const upgraded = new Kysely<DB>({ dialect: new PGliteDialect(openPglite()) })
            await buildPreUpdate(upgraded, migrations, latestFramework)

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

    test(
        'refuses, before running anything, a migration that would run after a later one of its own sequence',
        { timeout: 30_000 },
        async () => {
            // The framework sequence always has several migrations, so this runs under every seam (the
            // starter registers a single app migration). outOfSequence's unit case covers the app sequence.
            const first = Object.keys(frameworkMigrations).sort()[0]!
            const db = new Kysely<DB>({ dialect: new PGliteDialect(openPglite()) })
            await migrateToLatest(db)
            // The database forgets it ran the FIRST framework migration, as if it had been renumbered below
            // migrations already applied.
            await sql`DELETE FROM kysely_migration WHERE name = ${first}`.execute(db)
            await expect(migrateToLatest(db)).rejects.toThrow(
                new RegExp(`out of order within their sequence: ${first}`),
            )
            await db.destroy()
        },
    )

    test(
        "a renamed migration still gets Kysely's missing-migration error, not the out-of-order one",
        { timeout: 30_000 },
        async () => {
            const renamed = Object.keys(frameworkMigrations).sort()[1]!
            const db = new Kysely<DB>({ dialect: new PGliteDialect(openPglite()) })
            await migrateToLatest(db)
            // The database ran a migration under a name the code no longer has; the code's name is pending.
            await sql`UPDATE kysely_migration SET name = ${`${renamed}_old_name`} WHERE name = ${renamed}`.execute(db)
            await expect(migrateToLatest(db)).rejects.toThrow(
                new RegExp(`previously executed migration ${renamed}_old_name is missing`),
            )
            await db.destroy()
        },
    )

    test(
        'an app migration that builds on the newest framework migration arrives with it, and both apply',
        { timeout: 30_000 },
        async () => {
            // A synthetic registry, so the case does not depend on what keel's newest migration happens to
            // be: the app's 1002 indexes a column that only the framework's 0002 adds.
            const registry: Record<string, Migration> = {
                '0001_base': step('CREATE TABLE base (id int)'),
                '0002_newest': step('ALTER TABLE base ADD COLUMN detail text'),
                '1001_app': step('CREATE TABLE app_thing (id int)'),
                '1002_app_on_newest': step('CREATE INDEX base_detail_idx ON base (detail)'),
            }
            const upgraded = new Kysely<DB>({ dialect: new PGliteDialect(openPglite()) })
            expect(await buildPreUpdate(upgraded, registry, '0002_newest')).toEqual(['0001_base', '1001_app'])

            await migrateRegistryToLatest(upgraded, registry)
            const ran = await sql<{ name: string }>`SELECT name FROM kysely_migration`.execute(upgraded)
            expect(ran.rows.map((row) => row.name).sort()).toEqual(Object.keys(registry).sort())

            const fresh = new Kysely<DB>({ dialect: new PGliteDialect(openPglite()) })
            await migrateRegistryToLatest(fresh, registry)
            expect(await schemaOf(upgraded)).toEqual(await schemaOf(fresh))
            await upgraded.destroy()
            await fresh.destroy()
        },
    )
})
