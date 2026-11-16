import { Kysely, sql } from 'kysely'

/**
 * Which CREDENTIAL an audited actor used. `actor_user_id` names WHO acted: a person's user id, a
 * machine's `<kind>:<id>`, or a `system:*` writer. Since actors can reach the app without a session (an
 * inbound email, a personal API token, a service key), "who" alone no longer says how: a publish by
 * token read the same as one in the browser. These two columns record it (ADR-0012 addendum,
 * 2026-11-16):
 *
 * - `credential_kind`: `session`, `inbound-email`, `service-key`, or a kind the app registers
 *   (keel/core/abilities `PersonCredentialKind` / `MachineCredentialKind`).
 * - `credential_id`: WHICH one, such as a token's row id, a service key's id, or the inbound email's
 *   id. Never a secret. NULL when there is nothing to name (a session).
 *
 * Both are NULLABLE, and NULL means "not recorded". Every row written before this migration has NULL,
 * and so does every writer that doesn't pass a credential (`recordAuditEvent`'s `credential` is
 * optional). A NOT NULL default would have had to claim a kind for rows nobody can vouch for.
 *
 * The table's grant is unchanged: `app_user` keeps SELECT and INSERT only. Postgres grants at table
 * level cover columns added later, so the audit trail stays append-only with no new GRANT.
 */
export async function up(db: Kysely<any>): Promise<void> {
    await sql`ALTER TABLE audit_events ADD COLUMN credential_kind text, ADD COLUMN credential_id text`.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
    await sql`ALTER TABLE audit_events DROP COLUMN credential_id, DROP COLUMN credential_kind`.execute(db)
}
