import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('tenants')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('slug', 'text', (col) => col.notNull().unique())
        .execute()

    await db.schema
        .createTable('notes')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id'))
        .addColumn('body', 'text', (col) => col.notNull())
        .execute()

    // RLS is hand-written SQL under any query builder — write-once, and it lives with the schema.
    // FORCE covers table-owner queries; the app role is what production connections SET ROLE to.
    await sql`CREATE ROLE app_user NOLOGIN`.execute(db)
    await sql`GRANT USAGE ON SCHEMA public TO app_user`.execute(db)
    await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user`.execute(db)
    await sql`ALTER TABLE notes ENABLE ROW LEVEL SECURITY`.execute(db)
    await sql`ALTER TABLE notes FORCE ROW LEVEL SECURITY`.execute(db)
    // Fail-closed when no tenant context is set: two-arg current_setting yields NULL on a fresh
    // session, but an EMPTY STRING once any prior transaction has SET LOCAL the GUC (Postgres
    // quirk) — and ''::uuid throws. NULLIF collapses both cases to NULL -> zero rows, no error.
    await sql`
        CREATE POLICY tenant_isolation ON notes
        FOR ALL
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('notes').execute()
    await db.schema.dropTable('tenants').execute()
    await sql`DROP ROLE IF EXISTS app_user`.execute(db)
}
