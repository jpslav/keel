import { Kysely, sql } from 'kysely'

/**
 * Scheduled/recurring work: an org-scoped `job_schedules` table. Carries the full RLS
 * pattern (ADR-0004 tenant isolation) verbatim — the hostile-isolation boundary is still the tenant; `org_id` is
 * an app-level filter (NOT NULL here: every schedule belongs to exactly one team), the same shape as
 * audit_events. `spec` is the jsonb timing rule validated by packages/keel/src/core/schedules.ts;
 * `next_run_at` is the precomputed next fire time the cross-tenant due-scan orders by and advances
 * (in the same FOR UPDATE transaction as the spawn, so a tick that fires twice can't double-spawn).
 *
 * Full SELECT/INSERT/UPDATE/DELETE grant, the posture a mutable table wants: the scheduler UPDATEs
 * next_run_at, and an
 * instance's admin UI (out of this slice's scope) would toggle `enabled` / delete rows. The RLS
 * proof suite (packages/keel/src/db/rls-proofs.ts) asserts tenant isolation both directions, matching 0004.
 */
export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('job_schedules')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id'))
        .addColumn('org_id', 'uuid', (col) => col.notNull().references('organizations.id'))
        .addColumn('kind', 'text', (col) => col.notNull())
        .addColumn('spec', 'jsonb', (col) => col.notNull())
        .addColumn('next_run_at', 'timestamptz', (col) => col.notNull())
        .addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(true))
        // Opaque creator id (no users table) — same convention as jobs / service_keys.
        .addColumn('created_by', 'text', (col) => col.notNull())
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute()

    // The due-scan orders every enabled tenant's rows by next_run_at, so index the drain predicate.
    await db.schema
        .createIndex('job_schedules_due_idx')
        .on('job_schedules')
        .columns(['enabled', 'next_run_at'])
        .execute()

    await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON job_schedules TO app_user`.execute(db)
    await sql`ALTER TABLE job_schedules ENABLE ROW LEVEL SECURITY`.execute(db)
    await sql`ALTER TABLE job_schedules FORCE ROW LEVEL SECURITY`.execute(db)
    // NULLIF: unset tenant context must mean zero rows, never a cast error (see ADR-0002 spike findings).
    await sql`
        CREATE POLICY tenant_isolation ON job_schedules
        FOR ALL
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('job_schedules').execute()
}
