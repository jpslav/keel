import { Kysely, sql } from 'kysely'

/**
 * The tickets table — the desk's central noun, and the app's reference tenant-scoped table, carrying
 * the full RLS pattern proven in spikes/kysely-pglite (ADR-0004). Numbered 1001 because app migrations
 * start there (ADR-0012); it runs AFTER the framework's organizations table (0003), so it carries its
 * own nullable `org_id` column directly — a framework migration must never touch an app table.
 * `org_id` is nullable so the RLS proof suite and any legacy rows stay valid; the app's WHERE excludes
 * NULL (ADR-0004).
 *
 * Unlike the other two app tables this one keeps a FULL SELECT/INSERT/UPDATE/DELETE grant: a ticket is
 * ordinary working data an agent edits and deletes (the update/delete routes are the reachable end of
 * the `Ticket: update|delete` ability rules), whereas an escalation is an auditable decision that may
 * only be soft-cancelled and an attachment is bytes that only move pending → ready.
 */
export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('tickets')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id'))
        // Nullable app-level org filter (references the framework organizations table, which exists by
        // now); the app filters tickets by the active org, NULL is excluded.
        .addColumn('org_id', 'uuid', (col) => col.references('organizations.id'))
        // The human-facing desk number. Unique WITHIN a tenant, never globally: two sites number their
        // own queues independently, and the uniqueness is scoped exactly like every other tenant fact.
        .addColumn('ref', 'text', (col) => col.notNull())
        .addColumn('subject', 'text', (col) => col.notNull())
        .addColumn('body', 'text', (col) => col.notNull())
        // open → pending → resolved (and back), guarded by ticketMachine in src/domain/tickets.ts.
        .addColumn('status', 'text', (col) => col.notNull().defaultTo('open'))
        // Opaque user id (no users table) — same convention as jobs / service_keys. Null = unassigned.
        .addColumn('assignee_user_id', 'text')
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute()

    // org_id is the list filter (WHERE org_id = active org), so it is indexed like the other tables'.
    // The queue is also PAGED (keel/db/keyset), which wants a composite (tenant, org, created_at desc,
    // id desc) on top of this one — added in 1004 because the paging came later. A new table you
    // intend to page should carry that index here, in its own create migration, rather than trailing
    // one behind it.
    await db.schema.createIndex('tickets_org_id_idx').on('tickets').column('org_id').execute()
    await db.schema.createIndex('tickets_tenant_ref_idx').on('tickets').columns(['tenant_id', 'ref']).unique().execute()

    await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON tickets TO app_user`.execute(db)
    await sql`ALTER TABLE tickets ENABLE ROW LEVEL SECURITY`.execute(db)
    await sql`ALTER TABLE tickets FORCE ROW LEVEL SECURITY`.execute(db)
    // NULLIF: unset tenant context must mean zero rows, never a cast error — a session that has
    // ever SET LOCAL this GUC reports '' (not NULL) afterwards. See ADR-0002 spike findings.
    await sql`
        CREATE POLICY tenant_isolation ON tickets
        FOR ALL
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('tickets').execute()
}
