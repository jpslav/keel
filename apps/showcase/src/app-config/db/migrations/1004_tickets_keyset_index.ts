import { Kysely } from 'kysely'

/**
 * The index that makes the desk's queue pageable (`keel/db/keyset`).
 *
 * A keyset page reads `WHERE tenant_id = … AND org_id = … AND (created_at, id) < ($1, $2)
 * ORDER BY created_at DESC, id DESC LIMIT n`. Without a matching index that is a scan of the org's
 * whole queue on EVERY page — correct, but no faster than the offset paging keyset exists to
 * replace, and quietly worse the deeper you walk. The column order mirrors the query exactly:
 * equality columns first (`tenant_id` is not just the RLS anchor, it is a predicate the policy adds
 * to every statement, so it belongs in the index too), then the ordering pair in the direction the
 * walk reads them, so Postgres can satisfy the row-value comparison as a start condition and the
 * ORDER BY as a plain forward scan — no sort node, no discarded rows.
 *
 * A SEPARATE migration rather than an edit to 1001 on purpose: this is the shape of the change an
 * adopter actually makes — a list that grew, on a table that already exists — and an already-applied
 * migration is a historical record, not a document to revise. A brand-new table meant to be paged
 * should carry this index in its own create migration instead of trailing one behind it.
 *
 * Not unique: two rows genuinely can share `(tenant_id, org_id, created_at)` — a batch written in one
 * transaction shares one `now()` — which is exactly why `id` is in the key at all.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
    await db.schema
        .createIndex('tickets_keyset_idx')
        .on('tickets')
        .columns(['tenant_id', 'org_id', 'created_at desc', 'id desc'])
        .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropIndex('tickets_keyset_idx').execute()
}
