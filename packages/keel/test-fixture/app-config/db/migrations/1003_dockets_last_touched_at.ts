import { Kysely, sql } from 'kysely'

/**
 * `dockets.last_touched_at` — a second NOT NULL `timestamptz`, beside `created_at`. It exists so keel's
 * own suite has a genuine alternate ordering key to prove `keysetPage`'s `orderBy` against
 * (../rls-proofs.ts): a column that can order a different way from `created_at` and carry ties of its
 * own. Defaults to `now()`, so existing rows and inserts that never mention it stay valid.
 */
export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .alterTable('dockets')
        .addColumn('last_touched_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('dockets').dropColumn('last_touched_at').execute()
}
