import { Kysely, sql } from 'kysely'

/**
 * Async work (ADR-0004): a tenant-scoped `jobs` table plus an append-only
 * `job_status_changes` timeline. Both carry the full RLS pattern (ADR-0004 tenant isolation) verbatim — the
 * hostile-isolation boundary is still the tenant. One deliberate difference: app_user gets only
 * SELECT, INSERT on `job_status_changes`, so the history is immutable at the privilege layer (no
 * UPDATE/DELETE grant); the RLS proof suite asserts that append-only guarantee.
 */
export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('jobs')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id'))
        .addColumn('org_id', 'uuid', (col) => col.references('organizations.id'))
        .addColumn('kind', 'text', (col) => col.notNull())
        .addColumn('payload', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
        .addColumn('status', 'text', (col) => col.notNull().defaultTo('queued'))
        .addColumn('result_key', 'text')
        .addColumn('error', 'text')
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute()

    await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON jobs TO app_user`.execute(db)
    await sql`ALTER TABLE jobs ENABLE ROW LEVEL SECURITY`.execute(db)
    await sql`ALTER TABLE jobs FORCE ROW LEVEL SECURITY`.execute(db)
    // NULLIF: unset tenant context must mean zero rows, never a cast error (see ADR-0002 spike findings).
    await sql`
        CREATE POLICY tenant_isolation ON jobs
        FOR ALL
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    `.execute(db)

    await db.schema
        .createTable('job_status_changes')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id'))
        .addColumn('job_id', 'uuid', (col) => col.notNull().references('jobs.id'))
        .addColumn('status', 'text', (col) => col.notNull())
        .addColumn('message', 'text')
        .addColumn('at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute()

    await db.schema.createIndex('job_status_changes_job_id_idx').on('job_status_changes').column('job_id').execute()

    // Append-only at the privilege layer: SELECT + INSERT only — no UPDATE/DELETE grant, so a
    // recorded transition can never be rewritten or erased (proved in packages/keel/src/db/rls-proofs.ts).
    await sql`GRANT SELECT, INSERT ON job_status_changes TO app_user`.execute(db)
    await sql`ALTER TABLE job_status_changes ENABLE ROW LEVEL SECURITY`.execute(db)
    await sql`ALTER TABLE job_status_changes FORCE ROW LEVEL SECURITY`.execute(db)
    await sql`
        CREATE POLICY tenant_isolation ON job_status_changes
        FOR ALL
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('job_status_changes').execute()
    await db.schema.dropTable('jobs').execute()
}
