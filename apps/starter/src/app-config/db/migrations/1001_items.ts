import { Kysely, sql } from 'kysely'

/**
 * The `items` table — this app's only tenant-scoped table, carrying the RLS pattern proven in
 * spikes/kysely-pglite (ADR-0004). It runs after every framework migration (name-sorted, 0001–0999
 * first), so it can reference `tenants` and `organizations` directly.
 *
 * Two deliberate differences from the showcase's reference `1001_tickets`: `org_id` is NOT NULL (this
 * app has no legacy rows to keep valid), and DELETE is NOT granted — an item can be listed and created,
 * never erased, which is the posture most real tables want and is proved in ../rls-proofs.ts.
 */
export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('items')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id'))
        .addColumn('org_id', 'uuid', (col) => col.notNull().references('organizations.id'))
        .addColumn('title', 'text', (col) => col.notNull())
        .addColumn('created_by_user_id', 'text', (col) => col.notNull())
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute()

    await sql`GRANT SELECT, INSERT, UPDATE ON items TO app_user`.execute(db)
    await sql`ALTER TABLE items ENABLE ROW LEVEL SECURITY`.execute(db)
    await sql`ALTER TABLE items FORCE ROW LEVEL SECURITY`.execute(db)
    // NULLIF: unset tenant context must mean zero rows, never a cast error — a session that has
    // ever SET LOCAL this GUC reports '' (not NULL) afterwards. See ADR-0002 spike findings.
    await sql`
        CREATE POLICY tenant_isolation ON items
        FOR ALL
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('items').execute()
}
