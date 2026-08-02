import { Kysely } from 'kysely'
import { Migrator } from 'kysely/migration'
import { PGlite } from '@electric-sql/pglite'
import { PGliteDialect } from './pglite-dialect.js'
import type { DB } from './schema.js'
import * as init from './migrations/0001_init.js'

/** Fresh in-memory Postgres with all migrations applied — the same Migrator code path real Postgres uses. */
export async function createTestDb(): Promise<Kysely<DB>> {
    const db = new Kysely<DB>({ dialect: new PGliteDialect(new PGlite()) })
    const migrator = new Migrator({
        db,
        provider: {
            async getMigrations() {
                return { '0001_init': init }
            },
        },
    })
    const { error } = await migrator.migrateToLatest()
    if (error) throw error
    return db
}
