import { Kysely, sql } from 'kysely'

/**
 * Organizations (product copy: "teams") group users within one tenant. Infra table like `tenants`
 * (no RLS): a team is a collaboration boundary inside one customer, not a hostile-isolation boundary.
 * App tables reference it (the app's own tables carry a nullable-or-NOT-NULL `org_id`
 * that references organizations.id) — this framework migration creates the table those app migrations
 * (≥1001, ADR-0012) point at; it never touches an app table itself (the showcase's own `org_id`
 * columns live in its own >=1001 migrations).
 */
export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('organizations')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id'))
        .addColumn('slug', 'text', (col) => col.notNull())
        .addColumn('name', 'text', (col) => col.notNull())
        // Slugs are unique within a tenant (globally unique in seed while clerk-dev is shared).
        .addUniqueConstraint('organizations_tenant_slug_unique', ['tenant_id', 'slug'])
        .execute()

    await sql`GRANT SELECT ON organizations TO app_user`.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('organizations').execute()
}
