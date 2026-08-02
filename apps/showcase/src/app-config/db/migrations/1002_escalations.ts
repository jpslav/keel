import { Kysely, sql } from 'kysely'

/**
 * Escalations — the scaffold's reference pattern for two-sided, cross-org
 * collaboration. A request is raised by one org (`requester_org_id`) and addressed to another
 * (`responder_org_id`); BOTH orgs must be able to see the same row, and the responder decides its
 * outcome (accepted/rejected), the requester may withdraw it (cancelled).
 *
 * The RLS boundary stays EXACTLY tenant-only, carrying the shared tenant-isolation pattern (ADR-0004) verbatim: the
 * hostile-isolation boundary is still the tenant, never the org. Cross-org collaboration lives WITHIN
 * one tenant (orgs never span tenants), so the two org sides are an APP-LEVEL filter layered on top of
 * the tenant RLS scope — `where(requester_org_id = X OR responder_org_id = X)` — NOT a second RLS
 * policy (ADR-0004). This is deliberate: a per-org RLS policy would have to encode "either
 * side" in SQL and re-derive it on every table that references an org, whereas org membership is
 * already enforced at the auth port and the authorization seam. So 1002 is the reference for
 * two-sided app-level org scoping — copy its shape, not a bespoke RLS policy, for future cross-org
 * tables.
 *
 * Privilege guard: app_user gets SELECT, INSERT, UPDATE — NO DELETE. Withdrawing a request is a soft
 * transition to 'cancelled' (an UPDATE), never a row deletion, so a request's existence and audit
 * trail (created_by, decided_by, timestamps) can never be erased by the app role. The RLS proof
 * suite asserts the missing DELETE privilege.
 */
export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('escalations')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id'))
        // Both sides are NOT NULL — an escalation is meaningless without both ends. They are an
        // app-level filter, not an RLS anchor (see the doc comment above).
        .addColumn('requester_org_id', 'uuid', (col) => col.notNull().references('organizations.id'))
        .addColumn('responder_org_id', 'uuid', (col) => col.notNull().references('organizations.id'))
        // Opaque user id (no users table — same convention as jobs / service_keys).
        .addColumn('created_by_user_id', 'text', (col) => col.notNull())
        .addColumn('subject', 'text', (col) => col.notNull())
        .addColumn('body', 'text', (col) => col.notNull())
        .addColumn('status', 'text', (col) => col.notNull().defaultTo('open'))
        // Null while open; records WHO drove the terminal transition — the responder's manager on
        // accept/reject, the requester on withdrawal (cancel).
        .addColumn('decided_by_user_id', 'text')
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        // A request must cross an org boundary — the two sides can never be the same org. The app
        // rejects a self-directed request with a 400 first; this CHECK is the database backstop.
        .addCheckConstraint('escalations_distinct_sides', sql`requester_org_id <> responder_org_id`)
        .execute()

    // Both FK columns are queried in the two-sided WHERE (requester OR responder), so both are indexed.
    await db.schema
        .createIndex('escalations_requester_org_id_idx')
        .on('escalations')
        .column('requester_org_id')
        .execute()
    await db.schema
        .createIndex('escalations_responder_org_id_idx')
        .on('escalations')
        .column('responder_org_id')
        .execute()

    // SELECT, INSERT, UPDATE only — NO DELETE. Withdrawal is a soft transition to 'cancelled', so a
    // request row (and its audit trail) can never be erased by the app role (proved in src/app-config/db/rls-proofs.ts).
    await sql`GRANT SELECT, INSERT, UPDATE ON escalations TO app_user`.execute(db)
    await sql`ALTER TABLE escalations ENABLE ROW LEVEL SECURITY`.execute(db)
    await sql`ALTER TABLE escalations FORCE ROW LEVEL SECURITY`.execute(db)
    // NULLIF: unset tenant context must mean zero rows, never a cast error (see ADR-0002 spike findings). The
    // policy is tenant-only on purpose — the two org sides are filtered by the app, not by RLS.
    await sql`
        CREATE POLICY tenant_isolation ON escalations
        FOR ALL
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('escalations').execute()
}
