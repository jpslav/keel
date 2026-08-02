import { Kysely, sql } from 'kysely'

/**
 * The `dockets` table — the fixture's only tenant-scoped table, carrying the RLS pattern proven in
 * spikes/kysely-pglite (ADR-0004) exactly as the host apps' 1001 migrations do. It runs after every
 * framework migration (Kysely runs the composed registry NAME-SORTED, 0001–0999 first), so it can
 * reference `tenants` and `organizations` directly.
 *
 * DELETE is deliberately NOT granted: a docket can be listed, created and updated, never erased — the
 * posture most real tables want, and ../rls-proofs.ts proves it holds at the privilege layer.
 */
export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('dockets')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id'))
        .addColumn('org_id', 'uuid', (col) => col.notNull().references('organizations.id'))
        .addColumn('label', 'text', (col) => col.notNull())
        .addColumn('body', 'text', (col) => col.notNull())
        .addColumn('status', 'text', (col) => col.notNull().defaultTo('open'))
        .addColumn('created_by_user_id', 'text', (col) => col.notNull())
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute()

    await sql`GRANT SELECT, INSERT, UPDATE ON dockets TO app_user`.execute(db)
    await sql`ALTER TABLE dockets ENABLE ROW LEVEL SECURITY`.execute(db)
    await sql`ALTER TABLE dockets FORCE ROW LEVEL SECURITY`.execute(db)
    // NULLIF: unset tenant context must mean zero rows, never a cast error — a session that has
    // ever SET LOCAL this GUC reports '' (not NULL) afterwards. See ADR-0002 spike findings.
    await sql`
        CREATE POLICY tenant_isolation ON dockets
        FOR ALL
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('dockets').execute()
}
