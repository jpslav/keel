import { Kysely } from 'kysely'

/**
 * `dockets.due_on` — a bare `date` (a calendar day, no time, no zone). It exists so keel's own proof
 * suite has a real `date` column to read back on both engines: ../rls-proofs.ts pins that it arrives as
 * the wire string on pglite AND on real Postgres, which is what the two adapters' date parsers promise
 * (keel/adapters/real/db.ts, keel/adapters/fake/pglite-dialect.ts). Nullable — a docket need not be due.
 */
export async function up(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('dockets').addColumn('due_on', 'date').execute()
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('dockets').dropColumn('due_on').execute()
}
