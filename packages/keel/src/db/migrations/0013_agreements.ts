import { Kysely, sql } from 'kysely'

/**
 * Access gates + agreements. The worked example behind the gate seam (packages/keel/src/core/gates.ts):
 * versioned agreements (ToS / privacy / custom) whose GATING behavior is carried as DATA on the row
 * (block-all / advisory), plus an append-only record of who accepted which version when.
 *
 * ── TENANT-scoped, NOT org-scoped (a deliberate deviation from the generic default) ────────────────
 * Every other content table in this repo defaults to org-scoping (jobs, job_schedules and an app’s
 * own product tables carry org_id as an app-level filter). Agreements do NOT: an agreement is the
 * SITE's Terms of Service / privacy notice, which applies to EVERYONE in the tenant regardless of
 * which team they're acting in. So these
 * rows are keyed to the tenant ONLY — there is no org_id. The RLS boundary is the tenant (the same
 * NULLIF policy shape as 0004_jobs); tenant isolation is therefore the WHOLE isolation story here,
 * with no second app-level org filter on top. Recorded in the decision log.
 *
 * `agreements` — one row per current agreement. `version` is an int that increments IN PLACE (the row
 * id is stable): bumping the version (the Simulator demo story) is an UPDATE of this row, which re-arms
 * the gate for everyone whose latest acceptance is now below the current version. Hence SELECT, INSERT
 * (seed/create), UPDATE (bump/edit) — but NO DELETE grant: an agreement is a durable record.
 *
 * `agreement_acceptances` — APPEND-ONLY at the privilege layer (SELECT, INSERT only — the 0008
 * audit_events / job_status_changes precedent). `agreement_version` is DENORMALIZED onto the
 * acceptance so the exact version a user agreed to survives later edits/bumps of the agreement row (an
 * old acceptance stays truthful about what was agreed). `user_id` is an opaque actor id (no users
 * table — the jobs / service_keys / notifications convention). `metadata` is minimal jsonb (user-agent
 * etc). The RLS proof suite asserts the append-only guarantee (UPDATE and DELETE rejected) alongside
 * tenant isolation, for both tables.
 */
export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('agreements')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id'))
        // 'tos' | 'privacy' | 'custom' (packages/keel/src/core/agreements.ts AgreementKind); text here, validated at the seam.
        .addColumn('kind', 'text', (col) => col.notNull())
        // Increments IN PLACE on a version bump — the row id is stable; an acceptance below this is pending.
        .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
        .addColumn('title', 'text', (col) => col.notNull())
        // The agreement text — markdown, rendered simply. World CONTENT (like a note body), NOT a UI string.
        .addColumn('body_md', 'text', (col) => col.notNull())
        // 'block-all' | 'advisory' (packages/keel/src/core/agreements.ts AgreementGating) — the gate behavior as data.
        .addColumn('gating', 'text', (col) => col.notNull())
        // When this version took effect (set on create and on each bump). Distinct from created_at.
        .addColumn('effective_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute()

    // SELECT (reads) + INSERT (seed/create) + UPDATE (version bump / edit). No DELETE — durable record.
    await sql`GRANT SELECT, INSERT, UPDATE ON agreements TO app_user`.execute(db)
    await sql`ALTER TABLE agreements ENABLE ROW LEVEL SECURITY`.execute(db)
    await sql`ALTER TABLE agreements FORCE ROW LEVEL SECURITY`.execute(db)
    // NULLIF: unset tenant context must mean zero rows, never a cast error (see ADR-0002 spike findings).
    await sql`
        CREATE POLICY tenant_isolation ON agreements
        FOR ALL
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    `.execute(db)

    await db.schema
        .createTable('agreement_acceptances')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id'))
        .addColumn('agreement_id', 'uuid', (col) => col.notNull().references('agreements.id'))
        // DENORMALIZED — the version accepted, so it survives later edits/bumps of the agreement row.
        .addColumn('agreement_version', 'integer', (col) => col.notNull())
        // Opaque actor id (no users table) — same convention as jobs / service_keys / notifications.
        .addColumn('user_id', 'text', (col) => col.notNull())
        .addColumn('accepted_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        // Minimal capture context (user-agent etc) — jsonb, round-trips as a parsed object.
        .addColumn('metadata', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
        .execute()

    // The "my acceptances" scan and the pending computation both read by (user_id, agreement_id).
    await db.schema
        .createIndex('agreement_acceptances_user_idx')
        .on('agreement_acceptances')
        .columns(['user_id', 'agreement_id'])
        .execute()

    // Append-only at the privilege layer: SELECT + INSERT only — no UPDATE/DELETE grant, so an
    // acceptance can never be rewritten or erased (the audit_events / job_status_changes precedent).
    await sql`GRANT SELECT, INSERT ON agreement_acceptances TO app_user`.execute(db)
    await sql`ALTER TABLE agreement_acceptances ENABLE ROW LEVEL SECURITY`.execute(db)
    await sql`ALTER TABLE agreement_acceptances FORCE ROW LEVEL SECURITY`.execute(db)
    await sql`
        CREATE POLICY tenant_isolation ON agreement_acceptances
        FOR ALL
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('agreement_acceptances').execute()
    await db.schema.dropTable('agreements').execute()
}
