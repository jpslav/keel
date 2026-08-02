import { Kysely, sql } from 'kysely'

/**
 * Notifications: a prefs-driven fan-out seam over channels (in_app / email / sms). Two
 * org-scoped tables, both carrying the tenant RLS pattern (ADR-0004 tenant isolation) verbatim (the hostile
 * boundary is still the tenant; org_id is an app-level filter, NOT NULL like audit_events/job_schedules).
 *
 * `notifications` — one row per (recipient × delivered in-app notification). `recipient_user_id` is an
 * opaque actor id string (no users table — the jobs / service_keys convention). A row is a
 * DURABLE in-app record; marking read is an in-place UPDATE of `read_at` (SELECT/INSERT/UPDATE grant,
 * no DELETE — users don't delete notifications; the bell just stops counting read ones). The bell query
 * is "my unread": WHERE recipient_user_id = me AND read_at IS NULL, so the index is on
 * (recipient_user_id, read_at). Tenant RLS contains every read/write; the recipient filter is an
 * app-level WHERE on top (a user may only see/mark THEIR OWN rows — enforced at the route + query, the
 * same rls-independent second filter an app product table uses for org).
 *
 * `notification_prefs` — the OPT-OUT preference matrix: one row per (user × kind × channel) that the
 * user has explicitly toggled. ABSENCE OF A ROW MEANS ENABLED (default-on / opt-out — see the decision
 * log): a channel is off only when a row for that (kind, channel) exists with enabled = false. Full
 * SELECT/INSERT/UPDATE/DELETE grant: the profile prefs grid upserts a row on toggle. Uniqueness is
 * (tenant_id, org_id, user_id, kind, channel) so an upsert has a stable conflict target.
 */
export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('notifications')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id'))
        .addColumn('org_id', 'uuid', (col) => col.notNull().references('organizations.id'))
        // Opaque recipient actor id (no users table) — same convention as jobs / service_keys.
        .addColumn('recipient_user_id', 'text', (col) => col.notNull())
        // App-defined NotificationKind (packages/keel/src/core/notifications.ts); `text` here, validated at the seam.
        .addColumn('kind', 'text', (col) => col.notNull())
        // The kind's payload (packages/keel/src/core/notifications.ts) — jsonb, round-trips as a parsed object.
        .addColumn('payload', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
        // Null while unread; set to the read instant on mark-read (the bell counts read_at IS NULL).
        .addColumn('read_at', 'timestamptz')
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute()

    // The bell's "my unread" scan: recipient first, then read_at (partial-ish — both engines use it).
    await db.schema
        .createIndex('notifications_recipient_idx')
        .on('notifications')
        .columns(['recipient_user_id', 'read_at'])
        .execute()

    // SELECT/INSERT (fan-out inserts) + UPDATE (mark-read sets read_at). No DELETE grant: an in-app
    // notification is a durable record, never removed by a product path.
    await sql`GRANT SELECT, INSERT, UPDATE ON notifications TO app_user`.execute(db)
    await sql`ALTER TABLE notifications ENABLE ROW LEVEL SECURITY`.execute(db)
    await sql`ALTER TABLE notifications FORCE ROW LEVEL SECURITY`.execute(db)
    // NULLIF: unset tenant context must mean zero rows, never a cast error (see ADR-0002 spike findings).
    await sql`
        CREATE POLICY tenant_isolation ON notifications
        FOR ALL
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    `.execute(db)

    await db.schema
        .createTable('notification_prefs')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id'))
        .addColumn('org_id', 'uuid', (col) => col.notNull().references('organizations.id'))
        // Opaque user id (no users table) — the row's owner, who alone may read/change it.
        .addColumn('user_id', 'text', (col) => col.notNull())
        // NotificationKind × NotificationChannel this row toggles (packages/keel/src/core/notifications.ts).
        .addColumn('kind', 'text', (col) => col.notNull())
        .addColumn('channel', 'text', (col) => col.notNull())
        // The toggle. A row exists ONLY to override the default-on posture; enabled = false is an opt-out.
        .addColumn('enabled', 'boolean', (col) => col.notNull())
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute()

    // One row per (user, kind, channel) within an org — the upsert conflict target.
    await db.schema
        .createIndex('notification_prefs_unique_idx')
        .on('notification_prefs')
        .columns(['tenant_id', 'org_id', 'user_id', 'kind', 'channel'])
        .unique()
        .execute()

    await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON notification_prefs TO app_user`.execute(db)
    await sql`ALTER TABLE notification_prefs ENABLE ROW LEVEL SECURITY`.execute(db)
    await sql`ALTER TABLE notification_prefs FORCE ROW LEVEL SECURITY`.execute(db)
    await sql`
        CREATE POLICY tenant_isolation ON notification_prefs
        FOR ALL
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('notification_prefs').execute()
    await db.schema.dropTable('notifications').execute()
}
