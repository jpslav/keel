import { sql, type Transaction } from 'kysely'
import { keysetPage, parseDbKeysetCursor } from 'keel/db/keyset'
import type { RlsProofSuite } from 'keel/db/rls-proofs'
import type { DB } from 'keel/db/schema'
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
    dbPort,
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
    // ---- keysetPage `orderBy`: an alternate NOT NULL timestamptz key (1003) ----
    //
    // The framework half proves the pager's scope and precision guarantees for `created_at`. This proves
    // that `orderBy` moves ALL THREE uses of the key — the row-value comparison, the cursor's rendered
    // position, and the ORDER BY — onto another column together. Moving only some of them still returns
    // plausible-looking pages, so the check is a full walk at a page size that cuts through a tie.
    //
    // A fresh org, so these counts are untouched by every section above. Six dockets:
    //   0  oldest on BOTH columns
    //   1,2,3  created_at 2021-02/03/04, but ONE shared last_touched_at instant, with microseconds — a
    //          three-way tie the cursor must step through at full precision
    //   4  newest by created_at, but touched 2021-12-31
    //   5  OLDEST by created_at (2020-12-01) yet NEWEST by last_touched_at (2022-06-01)
    // so the two orderings disagree about which end docket 5 is on, and a pager that quietly kept
    // ordering by created_at cannot satisfy the last_touched_at expectations.
    const [orderOrg] = await db
        .insertInto('organizations')
        .values({ tenant_id: alphaTenantId, slug: `order-a-${Date.now()}`, name: 'Order Org A' })
        .returning('id')
        .execute()
    const tiedTouch = '2021-06-07T08:09:10.222222Z'
    const orderedDockets = [
        { created_at: '2021-01-01T00:00:00.000000Z', last_touched_at: '2021-01-01T00:00:00.000000Z' },
        { created_at: '2021-02-01T00:00:00.000000Z', last_touched_at: tiedTouch },
        { created_at: '2021-03-01T00:00:00.000000Z', last_touched_at: tiedTouch },
        { created_at: '2021-04-01T00:00:00.000000Z', last_touched_at: tiedTouch },
        { created_at: '2021-05-01T00:00:00.000000Z', last_touched_at: '2021-12-31T00:00:00.000000Z' },
        { created_at: '2020-12-01T00:00:00.000000Z', last_touched_at: '2022-06-01T00:00:00.000000Z' },
    ]
    await db
        .insertInto('dockets')
        .values(
            orderedDockets.map((stamps, index) => ({
                tenant_id: alphaTenantId,
                org_id: orderOrg!.id,
                label: `ordered-${index}`,
                body: 'body',
                created_by_user_id: 'proof-user',
                ...stamps,
            })),
        )
        .execute()
    // Rows are labelled by their position above; look the ids up rather than trust a multi-row
    // RETURNING order.
    const orderedRows = await runWithTenant(db, alphaTenantId, (trx) =>
        trx.selectFrom('dockets').select(['id', 'label']).where('org_id', '=', orderOrg!.id).execute(),
    )
    const indexById = new Map(orderedRows.map((r) => [r.id, Number(r.label.replace('ordered-', ''))]))
    // A named, typed `build` — an inline arrow with an untyped parameter next to a literal `orderBy`
    // makes TypeScript give up on inferring the table (see keysetPage's doc).
    const buildOrdered = (trx: Transaction<DB>) =>
        trx.selectFrom('dockets').select(['id', 'tenant_id']).where('org_id', '=', orderOrg!.id)

    /** Walk every page at `limit` and report the docket indexes in the order they were returned. */
    const walkOrdered = async (limit: number, orderBy?: 'created_at' | 'last_touched_at') => {
        const seen: Array<{ index: number; tenant_id: string }> = []
        let cursor: string | null = null
        for (let guard = 0; guard < 50; guard++) {
            const parsed = parseDbKeysetCursor(cursor)
            // A cursor the pager minted must always parse; anything else is the proof's own bug.
            expect(parsed.kind === 'invalid').toBe(false)
            const page = await keysetPage(
                dbPort,
                { tenantId: alphaTenantId, after: parsed.position ?? null, limit },
                buildOrdered,
                orderBy,
            )
            seen.push(...page.rows.map((r) => ({ index: indexById.get(r.id) ?? -1, tenant_id: r.tenant_id })))
            if (page.nextCursor === null) return seen
            cursor = page.nextCursor
        }
        throw new Error('keyset orderBy proof: the walk did not terminate')
    }

    // (a) the tie is real: six dockets, but only four distinct last_touched_at values.
    const touchStamps = await runWithTenant(db, alphaTenantId, (trx) =>
        trx.selectFrom('dockets').select('last_touched_at').where('org_id', '=', orderOrg!.id).execute(),
    )
    expect(touchStamps.length).toBe(6)
    expect(new Set(touchStamps.map((r) => String(r.last_touched_at))).size).toBe(4)

    // (b) ordered by last_touched_at, page size 2 (so a page boundary falls inside the three-way tie):
    // every docket exactly once, none from another tenant, 5 first, 4 second, 0 last, the tie in between.
    const touchedWalk = await walkOrdered(2, 'last_touched_at')
    const touchedOrder = touchedWalk.map((r) => r.index)
    expect(touchedOrder.length).toBe(6)
    expect(new Set(touchedOrder).size).toBe(6)
    expect(touchedWalk.every((r) => r.tenant_id === alphaTenantId)).toBe(true)
    expect(touchedOrder[0]).toBe(5)
    expect(touchedOrder[1]).toBe(4)
    expect(touchedOrder[5]).toBe(0)
    expect([...touchedOrder.slice(2, 5)].sort().join(',')).toBe('1,2,3')

    // (c) with no orderBy the order is exactly created_at DESC, as before the argument existed.
    const defaultWalk = await walkOrdered(2)
    expect(defaultWalk.map((r) => r.index).join(',')).toBe('4,3,2,1,0,5')

    // (d) naming created_at explicitly is the same as leaving it out.
    const explicitWalk = await walkOrdered(2, 'created_at')
    expect(explicitWalk.map((r) => r.index).join(',')).toBe(defaultWalk.map((r) => r.index).join(','))
}
