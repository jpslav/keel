import { Kysely, sql } from 'kysely'

/**
 * WHY an audited action came out as it did: a refused credential's reason (unknown, revoked, expired),
 * how many rows a purge removed. The row's other columns say who, what, when and with which credential;
 * none of them could say why. `detail` is a small JSON object (ADR-0012 addendum, 2026-11-17).
 *
 * - NULLABLE, no default. NULL means "no detail recorded": every row written before this migration, and
 *   every writer that passes none (`recordAuditEvent`'s `detail` is optional).
 * - The grant is unchanged: `app_user` keeps SELECT and INSERT only. Table-level grants cover columns
 *   added later (as in 0014), so a detail, once written, can never be corrected or redacted. That is why
 *   `recordAuditEvent` refuses a secret-shaped key or value, and a detail over its size bound, before it
 *   writes (keel/db/audit `AuditDetail`).
 * - No CHECK constraint. The rules are enforced where keel writes the column. A byte bound in SQL would
 *   measure jsonb's normalized text, which rewrites numbers and whitespace, so it would not measure what
 *   the writer measured, and the two bounds could disagree about the same detail.
 *
 * It names the one table it touches (the order-independence rule in ./index.ts).
 */
export async function up(db: Kysely<any>): Promise<void> {
    await sql`ALTER TABLE audit_events ADD COLUMN detail jsonb`.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
    await sql`ALTER TABLE audit_events DROP COLUMN detail`.execute(db)
}
