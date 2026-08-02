import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('tenants')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('slug', 'text', (col) => col.notNull().unique())
        .addColumn('name', 'text', (col) => col.notNull())
        .execute()

    // The non-superuser role every tenant-scoped transaction switches to (ADR-0004). Guarded:
    // roles are cluster-wide on real Postgres and may already exist.
    await sql`
        DO $$ BEGIN
            CREATE ROLE app_user NOLOGIN;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
    `.execute(db)
    await sql`GRANT USAGE ON SCHEMA public TO app_user`.execute(db)
    await sql`GRANT SELECT ON tenants TO app_user`.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('tenants').execute()
}
