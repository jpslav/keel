import { Kysely, sql } from 'kysely'

/**
 * Compliance-grade audit trail. A tenant-scoped `audit_events` table carrying the full RLS
 * pattern (ADR-0004 tenant isolation) verbatim — the hostile-isolation boundary is still the tenant. It is
 * "who did what when", distinct from the dev/telemetry analytics events (those live in the fake
 * analytics adapter's flat file; this is durable product data in the same database as the rows it
 * describes). Written from the mutation path by recordAuditEvent (packages/keel/src/db/audit.ts), immediately
 * after each successfully-authorized write.
 *
 * Append-only at the privilege layer: app_user gets only SELECT, INSERT — no UPDATE/DELETE grant,
 * so a recorded event can never be rewritten or erased (the job_status_changes precedent, 0004).
 * The RLS proof suite asserts that append-only guarantee alongside tenant isolation.
 *
 * org_id is NOT NULL (unlike jobs, which tolerates a null org for legacy/RLS-proof rows): every
 * audited mutation happens inside an active org, so an audit event without one would be a bug, not a
 * legacy shape. subject_id is nullable because a create records its event AFTER the row exists and
 * knows the id, but the column stays honest for any future action that has no single subject row.
 */
export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('audit_events')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id'))
        .addColumn('org_id', 'uuid', (col) => col.notNull().references('organizations.id'))
        .addColumn('actor_user_id', 'text', (col) => col.notNull())
        .addColumn('action', 'text', (col) => col.notNull())
        .addColumn('subject_type', 'text', (col) => col.notNull())
        .addColumn('subject_id', 'text')
        .addColumn('at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute()

    await db.schema.createIndex('audit_events_org_id_idx').on('audit_events').column('org_id').execute()

    // Append-only at the privilege layer: SELECT + INSERT only — no UPDATE/DELETE grant, so an audit
    // event can never be rewritten or erased (proved in packages/keel/src/db/rls-proofs.ts).
    await sql`GRANT SELECT, INSERT ON audit_events TO app_user`.execute(db)
    await sql`ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY`.execute(db)
    await sql`ALTER TABLE audit_events FORCE ROW LEVEL SECURITY`.execute(db)
    // NULLIF: unset tenant context must mean zero rows, never a cast error (see ADR-0002 spike findings).
    await sql`
        CREATE POLICY tenant_isolation ON audit_events
        FOR ALL
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('audit_events').execute()
}
