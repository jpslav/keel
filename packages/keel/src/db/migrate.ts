import type { Kysely } from 'kysely'
import { Migrator } from 'kysely/migration'
import { migrations } from './migrations/index'
import type { DB } from './schema'

/** Framework migrations are numbered 0001–0999 and the app's 1001 and up (ADR-0012). */
const sequenceOf = (name: string): 'framework' | 'app' => (name < '1000' ? 'framework' : 'app')

/**
 * The pending migrations that would run out of order WITHIN their own sequence: a migration that sorts
 * before one of the same sequence the database has already run. Unordered migration exists for the one
 * case the two sequences create, a framework migration arriving after app migrations ran. Anything
 * else out of order is still refused, such as two app branches whose 1006 ran before their 1005.
 */
export function outOfSequence(executed: readonly string[], pending: readonly string[]): string[] {
    return pending.filter((name) => executed.some((ran) => sequenceOf(ran) === sequenceOf(name) && ran > name))
}

export async function migrateToLatest(db: Kysely<DB>): Promise<void> {
    const migrator = new Migrator({
        db,
        provider: { getMigrations: async () => migrations },
        // Framework migrations (0001–0999) and the app's (≥1001) are TWO sequences interleaved by name
        // (ADR-0012). So a framework migration that arrives in a keel update sorts BEFORE app migrations
        // the database already ran. Kysely's default strict ordering refuses that as "corrupted
        // migrations", which made every new framework migration unappliable to any database that had
        // run one app migration. Unordered still runs the PENDING migrations in name order, and still
        // fails if a migration the database ran has disappeared, so a rename stays loud. Order WITHIN a
        // sequence is still enforced, by the check below.
        allowUnorderedMigrations: true,
    })
    const state = await migrator.getMigrations()
    const executed = state.filter((m) => m.executedAt !== undefined).map((m) => m.name)
    const stray = outOfSequence(
        executed,
        state.filter((m) => m.executedAt === undefined).map((m) => m.name),
    )
    if (stray.length > 0) {
        throw new Error(
            `migrations out of order within their sequence: ${stray.join(', ')} would run after a later ` +
                'migration of the same sequence already ran. Renumber them after the last one applied.',
        )
    }
    const { error } = await migrator.migrateToLatest()
    if (error) throw error instanceof Error ? error : new Error(String(error))
}
