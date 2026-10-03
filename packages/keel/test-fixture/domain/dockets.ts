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

/**
 * Marks one docket of one team `flagged` — the fixture's own preset operation kind, `docket.flag`, does
 * this to the docket an earlier `inbound` step opened (app-config/presets/operations/docket-flag). Scoped
 * by org as well as by tenant, so an id from another team updates nothing: false, never a cross-team write.
 */
export async function flagDocket(
    db: DbPort,
    input: { tenantId: string; orgId: string; docketId: string },
): Promise<boolean> {
    const row = await db.withTenant(input.tenantId, (trx) =>
        trx
            .updateTable('dockets')
            .set({ status: 'flagged' })
            .where('id', '=', input.docketId)
            .where('org_id', '=', input.orgId)
            .returning('id')
            .executeTakeFirst(),
    )
    return row !== undefined
}
