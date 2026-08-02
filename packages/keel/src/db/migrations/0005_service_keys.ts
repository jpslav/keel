import { Kysely, sql } from 'kysely'

/**
 * Service keys (M2M auth): the public half of each org's service-caller signing keypair. An
 * infra table like `organizations` (NO RLS) on purpose: it is read during request AUTHENTICATION —
 * before any tenant context exists, since resolving the caller is what establishes that context —
 * and it holds only public key material. The tenant boundary here is enforced CRYPTOGRAPHICALLY
 * (a caller proves possession of the matching private key), not by row-level security.
 *
 * app_user gets SELECT ONLY: request paths verify against these rows but never write them. Rows are
 * minted by the privileged owner (fake: the mint helper's raw handle; real: the provisioning step),
 * so app_user has no INSERT/UPDATE/DELETE grant — the RLS proof suite asserts that.
 */
export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('service_keys')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id'))
        .addColumn('org_id', 'uuid', (col) => col.notNull().references('organizations.id'))
        .addColumn('public_key_pem', 'text', (col) => col.notNull())
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('revoked_at', 'timestamptz')
        .execute()

    await db.schema.createIndex('service_keys_org_id_idx').on('service_keys').column('org_id').execute()

    // SELECT ONLY: verification reads these during request auth; writes are privileged-owner only.
    await sql`GRANT SELECT ON service_keys TO app_user`.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('service_keys').execute()
}
