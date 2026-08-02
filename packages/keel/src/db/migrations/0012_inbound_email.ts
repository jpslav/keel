import { Kysely, sql } from 'kysely'

/**
 * Inbound email: the receiving half of the Mailgun vendor. One tenant-scoped table carrying
 * the RLS pattern (ADR-0004 tenant isolation) verbatim — the hostile boundary is still the tenant. Every inbound
 * message that resolves to a tenant is filed here as a durable, normalized record, then a handler is
 * run against it (the demo registers `support` and `feedback`).
 *
 * `org_id` is NULLable, unlike audit/notifications/schedules. An inbound message is filed under a
 * tenant (RLS anchor) but may fail to resolve to a specific org — in a real MULTI-domain instance the
 * recipient DOMAIN maps to the tenant while the local part names the org, so tenant can be known while
 * org is not (an unknown org slug, or a deliverability event like bounce/complaint that belongs to the
 * domain's tenant but no team). The single-domain template resolves the tenant FROM the org and so
 * never actually writes a null-org row through intake, but the column stays honest for that real path
 * and the RLS proof exercises it. See the decision log (address scheme + org resolution).
 *
 * `status` is the intake outcome: 'received' (stored, not yet run — transient), 'handled' (a handler
 * produced its effect), 'unmatched' (no registered handler for the address's handler slug, or the
 * handler ran but declined — e.g. a message from a sender who is not a team member), 'failed'
 * (a handler threw — the row is KEPT and the webhook still 200s so Mailgun never retries a poison
 * message; see the decision log). `handler` is the registered handler slug that PROCESSED the message,
 * NULL when no handler matched the slug. `error` carries the reason for unmatched/failed.
 *
 * Grant SELECT/INSERT/UPDATE (intake inserts 'received', then UPDATEs the final status) with NO DELETE:
 * an inbound record is durable like an audit/notification row. Retention is table-only (no TTL sweep in
 * the template — a high-volume/PII-sensitive instance adds one, which would need a DELETE grant; noted
 * in the decision log). A Snapshots reset wipes `.data/pglite` with the rest of the fake world.
 */
export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('inbound_emails')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id'))
        // NULLable on purpose (see the header) — org resolution may fail while the tenant is known.
        .addColumn('org_id', 'uuid', (col) => col.references('organizations.id'))
        .addColumn('from_email', 'text', (col) => col.notNull())
        .addColumn('to_email', 'text', (col) => col.notNull())
        .addColumn('subject', 'text', (col) => col.notNull().defaultTo(''))
        // Normalized plain text (quoted reply chains stripped minimally — packages/keel/src/core/inbound-email.ts).
        .addColumn('body_text', 'text', (col) => col.notNull().defaultTo(''))
        // Raw HTML kept when the sender provides it (cheap; the reading pane can render it later).
        .addColumn('body_html', 'text')
        // The registered handler slug that processed the message; NULL when no handler matched the slug.
        .addColumn('handler', 'text')
        // received | handled | unmatched | failed (see the header).
        .addColumn('status', 'text', (col) => col.notNull().defaultTo('received'))
        .addColumn('error', 'text')
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute()

    // The Simulator inbound list orders by arrival within a tenant; both engines use this.
    await db.schema
        .createIndex('inbound_emails_tenant_created_idx')
        .on('inbound_emails')
        .columns(['tenant_id', 'created_at'])
        .execute()

    // SELECT/INSERT (intake files the row) + UPDATE (intake sets the final status). No DELETE grant:
    // an inbound record is durable (the audit/notification precedent).
    await sql`GRANT SELECT, INSERT, UPDATE ON inbound_emails TO app_user`.execute(db)
    await sql`ALTER TABLE inbound_emails ENABLE ROW LEVEL SECURITY`.execute(db)
    await sql`ALTER TABLE inbound_emails FORCE ROW LEVEL SECURITY`.execute(db)
    // NULLIF: unset tenant context must mean zero rows, never a cast error (see ADR-0002 spike findings).
    await sql`
        CREATE POLICY tenant_isolation ON inbound_emails
        FOR ALL
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('inbound_emails').execute()
}
