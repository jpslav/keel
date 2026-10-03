import { sql } from 'kysely'
import type { RlsProofSuite } from 'keel/db/rls-proofs'
import { runWithTenant } from 'keel/db/with-tenant'

/**
 * The APP's tenant-isolation proofs (the seam side of keel/db/rls-proofs.ts, ADR-0004 + ADR-0012) —
 * one section per app table, asserting exactly what the framework half asserts for its own: read
 * isolation both directions under UNFILTERED selects, WITH CHECK on cross-tenant writes, and the
 * per-table privilege grants.
 *
 * keel/db/rls-proof-runner.ts composes this with the framework half and runs the union, so these
 * assertions execute wherever that runner does — for the fixture, the pglite suite AND real Postgres
 * (keel/adapters/real/db.contract.test.ts). Kept in lockstep with ./migrations.
 */
export const appRlsProofs: RlsProofSuite = async ({
    db,
    expect,
    alphaTenantId,
    demoTenantId,
    alphaOrgId,
    demoOrgId,
}) => {
    // ---- dockets: tenant-only RLS (1001), single-org app scoping, SELECT/INSERT/UPDATE (no DELETE) ----

    await db
        .insertInto('dockets')
        .values([
            {
                tenant_id: alphaTenantId,
                org_id: alphaOrgId,
                label: 'first docket',
                body: 'body',
                created_by_user_id: 'proof-user',
            },
            {
                tenant_id: alphaTenantId,
                org_id: alphaOrgId,
                label: 'second docket',
                body: 'body',
                created_by_user_id: 'proof-user',
            },
            {
                tenant_id: demoTenantId,
                org_id: demoOrgId,
                label: 'other tenant docket',
                body: 'body',
                created_by_user_id: 'proof-user',
            },
        ])
        .execute()

    // read isolation, both directions, via UNFILTERED selects under RLS
    const ours = await runWithTenant(db, alphaTenantId, (trx) => trx.selectFrom('dockets').selectAll().execute())
    expect(ours.filter((r) => r.tenant_id === demoTenantId).length).toBe(0)
    expect(ours.filter((r) => r.tenant_id === alphaTenantId).length).toBe(2)
    const theirs = await runWithTenant(db, demoTenantId, (trx) => trx.selectFrom('dockets').selectAll().execute())
    expect(theirs.filter((r) => r.tenant_id === alphaTenantId).length).toBe(0)
    expect(theirs.filter((r) => r.tenant_id === demoTenantId).length).toBe(1)

    // write isolation: an INSERT carrying the OTHER tenant's id is rejected by WITH CHECK, even though
    // the org id is a real org — the tenant, not the org, is the RLS boundary.
    let writeRejected = false
    try {
        await runWithTenant(db, alphaTenantId, (trx) =>
            trx
                .insertInto('dockets')
                .values({
                    tenant_id: demoTenantId,
                    org_id: demoOrgId,
                    label: 'smuggled',
                    body: 'body',
                    created_by_user_id: 'proof-user',
                })
                .execute(),
        )
    } catch (error) {
        writeRejected = /row-level security/.test(String(error))
    }
    expect(writeRejected).toBe(true)

    // DELETE is denied at the PRIVILEGE layer — the 1001 grant is SELECT/INSERT/UPDATE only, so a
    // docket can never be erased even by a correctly-scoped caller.
    let deleteRejected = false
    try {
        await db.transaction().execute(async (trx) => {
            await sql`SET LOCAL ROLE app_user`.execute(trx)
            await sql`SELECT set_config('app.current_tenant', ${alphaTenantId}, true)`.execute(trx)
            await sql`DELETE FROM dockets`.execute(trx)
        })
    } catch (error) {
        deleteRejected = /permission denied/.test(String(error))
    }
    expect(deleteRejected).toBe(true)

    // ---- dockets.due_on: a `date` arrives as the wire string on BOTH engines (1002) ----
    //
    // Not an isolation proof — an engine-parity one, riding this suite because it is the one that runs on
    // pglite and on real Postgres alike. Left to their defaults the two drivers disagree on the SAME row:
    // `pg` builds a `Date` at local midnight (the previous day, read as UTC, anywhere east of UTC) and
    // pglite one at UTC midnight. Both adapters hand back the string instead; a `Date` from either fails
    // the `toBe` below in every timezone, so a dropped parser is caught on whichever engine dropped it.
    // The array read covers `date[]`, which `pg` parses separately from `date`.
    const [dueDocket] = await db
        .insertInto('dockets')
        .values({
            tenant_id: alphaTenantId,
            org_id: alphaOrgId,
            label: 'dated docket',
            body: 'body',
            created_by_user_id: 'proof-user',
            due_on: '2026-10-03',
        })
        .returning('id')
        .execute()
    const dated = await runWithTenant(db, alphaTenantId, (trx) =>
        trx
            .selectFrom('dockets')
            .select(['due_on', sql<string[]>`ARRAY[due_on, due_on + 1]`.as('due_window')])
            .where('id', '=', dueDocket!.id)
            .executeTakeFirstOrThrow(),
    )
    expect(dated.due_on).toBe('2026-10-03')
    expect(JSON.stringify(dated.due_window)).toBe('["2026-10-03","2026-10-04"]')
}
