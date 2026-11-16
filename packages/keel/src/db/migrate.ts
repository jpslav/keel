import type { Kysely } from 'kysely'
import { Migrator } from 'kysely/migration'
import { migrations } from './migrations/index'
import type { DB } from './schema'

export async function migrateToLatest(db: Kysely<DB>): Promise<void> {
    const migrator = new Migrator({
        db,
        provider: { getMigrations: async () => migrations },
        // Framework migrations (0001–0999) and the app's (≥1001) are TWO sequences interleaved by name
        // (ADR-0012). So a framework migration that arrives in a keel update sorts BEFORE app migrations
        // the database already ran. Kysely's default strict ordering refuses that as "corrupted
        // migrations", which made every new framework migration unappliable to any database that had
        // run one app migration. Unordered still runs the PENDING migrations in name order, and still
        // fails if a migration the database ran has disappeared, so a rename stays loud.
        allowUnorderedMigrations: true,
    })
    const { error } = await migrator.migrateToLatest()
    if (error) throw error instanceof Error ? error : new Error(String(error))
}
