import type { DbPort } from 'keel/ports/db'

/**
 * The fixture's one product write — the tenant-scoped INSERT its inbound-email handler performs, in the
 * same shape a real app's domain module would have it: `db.withTenant()` only, never `getDb()`.
 */
export async function insertDocket(
    db: DbPort,
    input: { tenantId: string; orgId: string; label: string; body: string; createdByUserId: string },
): Promise<{ id: string }> {
    return db.withTenant(input.tenantId, (trx) =>
        trx
            .insertInto('dockets')
            .values({
                tenant_id: input.tenantId,
                org_id: input.orgId,
                label: input.label,
                body: input.body,
                created_by_user_id: input.createdByUserId,
            })
            .returning('id')
            .executeTakeFirstOrThrow(),
    )
}
