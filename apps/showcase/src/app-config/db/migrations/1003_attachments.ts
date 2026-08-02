import { Kysely, sql } from 'kysely'

/**
 * Typed browser-uploaded attachments. Single-org scoped — the single-org tenant-isolation pattern, NOT the
 * two-sided 1002_escalations one: an attachment belongs to exactly one team (`org_id`, an app-level
 * filter on top of the tenant RLS scope). The RLS boundary stays EXACTLY tenant-only, carrying the
 * shared tenant-isolation policy (ADR-0004) verbatim; the org is filtered by the app, never by a second policy (ADR-0004).
 *
 * Flow (see src/domain/db/attachments.ts + the /api/attachments routes): the mint step INSERTs a `pending` row
 * with a SERVER-BUILT `storage_key` (`attachments/<tenant>/<uuid>/<name>` — never client-chosen) and
 * mints a presigned upload target; the browser uploads directly to storage; the confirm step verifies
 * the object landed, records its true `size_bytes`, and flips `status` to `ready` (the only UPDATE).
 * So the grant set is SELECT, INSERT, UPDATE — no DELETE this slice (no delete route yet; a future
 * one adds the grant alongside it). GET lists only `ready` rows, so a browser never sees a dead link.
 */
export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('attachments')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id'))
        // Single-org scope, NOT NULL — an attachment always belongs to a team (unlike tickets.org_id,
        // which is nullable only to keep legacy/RLS-proof rows valid). App-level filter, not an RLS anchor.
        .addColumn('org_id', 'uuid', (col) => col.notNull().references('organizations.id'))
        // App-defined kind (src/domain/attachments.ts). `text`, so the DB accepts any string; the mint route
        // validates against ATTACHMENT_KINDS, exactly as the jobs route guards `kind` with isJobKind.
        .addColumn('kind', 'text', (col) => col.notNull())
        .addColumn('filename', 'text', (col) => col.notNull())
        .addColumn('content_type', 'text', (col) => col.notNull())
        // Null until confirm records the object's true length (read from storage, never client-declared).
        .addColumn('size_bytes', 'integer')
        // Server-built object key — the prefix-lock lesson: never client-supplied.
        .addColumn('storage_key', 'text', (col) => col.notNull())
        // pending → ready. A pending row whose upload never lands just sits (harmless, never listed).
        .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
        // Opaque user id (no users table) — same convention as jobs / escalations / service_keys.
        .addColumn('uploaded_by_user_id', 'text', (col) => col.notNull())
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute()

    // org_id is the list filter (WHERE org_id = active org), so it's indexed like escalations' sides.
    await db.schema.createIndex('attachments_org_id_idx').on('attachments').column('org_id').execute()

    // SELECT, INSERT, UPDATE — NO DELETE this slice (mint inserts, confirm updates status; there's no
    // delete route yet). The RLS proof suite asserts the grant set (UPDATE succeeds, DELETE denied).
    await sql`GRANT SELECT, INSERT, UPDATE ON attachments TO app_user`.execute(db)
    await sql`ALTER TABLE attachments ENABLE ROW LEVEL SECURITY`.execute(db)
    await sql`ALTER TABLE attachments FORCE ROW LEVEL SECURITY`.execute(db)
    // NULLIF: unset tenant context must mean zero rows, never a cast error (see ADR-0002 spike findings). Tenant-only
    // on purpose — the org is filtered by the app, not by RLS.
    await sql`
        CREATE POLICY tenant_isolation ON attachments
        FOR ALL
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('attachments').execute()
}
