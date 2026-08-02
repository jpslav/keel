import { Kysely, sql } from 'kysely'

/**
 * Outbound webhooks: the last missing integration class — signed egress with retries. Two
 * org-scoped tables, both carrying the tenant RLS pattern (ADR-0004 tenant isolation) verbatim (the hostile
 * boundary is still the tenant; org_id is an app-level filter, NOT NULL like audit_events/job_schedules).
 *
 * `webhook_endpoints` — an instance-admin registers a URL + a set of subscribed event kinds. Full
 * SELECT/INSERT/UPDATE/DELETE grant like `job_schedules`: the org-admin card enables/disables
 * (UPDATE) and removes (DELETE) rows. The shared `secret` is stored plaintext here — a deliberate
 * template-level simplicity (a real instance may move it to a vault); see the decision log.
 *
 * `webhook_deliveries` — one row per (event × matching enabled endpoint), drained asynchronously by
 * runDueDeliveries (packages/keel/src/db/webhooks.ts) on the SAME ticks that drain schedules. Deliberately NOT
 * append-only like audit_events: `status`, `attempt_count`, `next_attempt_at`, `last_error` and
 * `delivered_at` are UPDATEd in place as the retry state machine advances. Full SELECT/INSERT/UPDATE/
 * DELETE grant: deliveries are OPERATIONAL records, and the endpoint FK is ON DELETE CASCADE so removing
 * an endpoint tidies its deliveries (the app-role DELETE grant is what lets that cascade run under FORCE
 * RLS). The DURABLE webhook record is the audit trail — webhook.delivered / webhook.dead events, which
 * ARE append-only (audit_events) — not the delivery row itself; see the decision log. The RLS proof
 * suite asserts tenant isolation both directions, the in-place status UPDATE, and the endpoint-delete
 * cascade.
 *
 * Lifecycle of a delivery `status`: 'pending' (never attempted) → 'failed' (last attempt errored,
 * retries remain, next_attempt_at armed with the backoff) → 'delivered' (success, terminal) or 'dead'
 * (max attempts exhausted, terminal). The backoff policy lives in packages/keel/src/core/webhook-events.ts.
 */
export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('webhook_endpoints')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id'))
        .addColumn('org_id', 'uuid', (col) => col.notNull().references('organizations.id'))
        .addColumn('url', 'text', (col) => col.notNull())
        // Shared HMAC secret (plaintext — template simplicity, see decision log). Shown once on create.
        .addColumn('secret', 'text', (col) => col.notNull())
        // jsonb array of WebhookEventKind strings the endpoint subscribes to (packages/keel/src/core/webhook-events.ts).
        .addColumn('event_kinds', 'jsonb', (col) => col.notNull())
        .addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(true))
        // Opaque creator id (no users table) — same convention as jobs / service_keys.
        .addColumn('created_by', 'text', (col) => col.notNull())
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute()

    await db.schema.createIndex('webhook_endpoints_org_id_idx').on('webhook_endpoints').column('org_id').execute()

    await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_endpoints TO app_user`.execute(db)
    await sql`ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY`.execute(db)
    await sql`ALTER TABLE webhook_endpoints FORCE ROW LEVEL SECURITY`.execute(db)
    // NULLIF: unset tenant context must mean zero rows, never a cast error (see ADR-0002 spike findings).
    await sql`
        CREATE POLICY tenant_isolation ON webhook_endpoints
        FOR ALL
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    `.execute(db)

    await db.schema
        .createTable('webhook_deliveries')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id'))
        .addColumn('endpoint_id', 'uuid', (col) => col.notNull().references('webhook_endpoints.id').onDelete('cascade'))
        .addColumn('event_kind', 'text', (col) => col.notNull())
        // The event payload (packages/keel/src/core/webhook-events.ts) — jsonb, round-trips as a parsed object.
        .addColumn('payload', 'jsonb', (col) => col.notNull())
        // pending → failed → delivered | dead (the retry state machine; see this file's header).
        .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
        .addColumn('attempt_count', 'integer', (col) => col.notNull().defaultTo(0))
        // When the drain should (re)attempt. Set to now on enqueue; advanced by the backoff on failure.
        // No DB default — always supplied (enqueue). Reads back a Date on both engines (toIso normalises).
        .addColumn('next_attempt_at', 'timestamptz', (col) => col.notNull())
        .addColumn('last_error', 'text')
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('delivered_at', 'timestamptz')
        .execute()

    // The due-scan orders each tenant's rows by next_attempt_at within the retryable statuses.
    await db.schema
        .createIndex('webhook_deliveries_due_idx')
        .on('webhook_deliveries')
        .columns(['status', 'next_attempt_at'])
        .execute()

    // SELECT/INSERT/UPDATE (the retry drain advances status/attempts in place) + DELETE (so the
    // endpoint ON DELETE CASCADE runs under app_user + FORCE RLS). The durable record is the audit trail.
    await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_deliveries TO app_user`.execute(db)
    await sql`ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY`.execute(db)
    await sql`ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY`.execute(db)
    await sql`
        CREATE POLICY tenant_isolation ON webhook_deliveries
        FOR ALL
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('webhook_deliveries').execute()
    await db.schema.dropTable('webhook_endpoints').execute()
}
