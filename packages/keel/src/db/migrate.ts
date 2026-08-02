import type { Kysely } from 'kysely'
import { Migrator } from 'kysely/migration'
import { migrations } from './migrations/index'
import type { DB } from './schema'

export async function migrateToLatest(db: Kysely<DB>): Promise<void> {
    const migrator = new Migrator({
        db,
        provider: { getMigrations: async () => migrations },
    })
    const { error } = await migrator.migrateToLatest()
    if (error) throw error instanceof Error ? error : new Error(String(error))
}
