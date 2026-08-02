import { sql } from 'kysely'
import { encodeKeysetCursor, parseKeysetCursor } from 'keel/core/keyset'
import { parseDbKeysetCursor } from 'keel/db/keyset'
import type { RlsProofSuite } from 'keel/db/rls-proofs'
import { runWithTenant } from 'keel/db/with-tenant'
import { listTickets } from '@/domain/db/tickets'

/**
 * The APP's tenant-isolation proofs (the seam side of packages/keel/src/db/rls-proofs.ts, ADR-0004 +
 * ADR-0012) — one section per app table (`tickets`, `escalations`, `attachments`, migrations ≥1001),
 * asserting exactly what the framework half asserts for its own: read isolation both directions under
 * UNFILTERED selects, WITH CHECK on cross-tenant writes, and the per-table privilege grants.
 *
 * Why it lives HERE and not with the framework suite: proofs that name app tables would make keel's own
 * tenancy proof un-runnable the moment an adopter deletes the demo app. The framework composes the two
 * halves in packages/keel/src/db/rls-proof-runner.ts and runs the union on BOTH engines (pglite unit +
 * real-Postgres contract), so the anti-drift guarantee is unchanged: the identical assertions run twice.
 *
 * A real adopter replaces this file's sections with proofs for its OWN ≥1001 tables; an adopter with no
 * tenant tables of its own leaves the body empty (ADR-0012, "unused capability = empty registration").
 * Kept in lockstep with src/app-config/db/migrations.
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
    // ---- tickets: tenant-only RLS (1001), full SELECT/INSERT/UPDATE/DELETE grant ----
    //
    // The app's simplest tenant table, and where the base guarantees are re-proved on the APP side of
    // the line: read isolation both directions, the negative control that proves those reads aren't
    // vacuous, fail-closed with no tenant context, WITH CHECK on write, a scoped write that lands, and
    // — unique among the three app tables — a scoped DELETE that lands, because tickets are the one
    // table the app really deletes from (migration 1001) and a granted DELETE deserves a proof that it
    // still cannot reach across the tenant boundary.
    //
    // Refs are stamped with the proof's own prefix so a contract run against a live database (which may
    // already hold seeded desk tickets) can never collide with the (tenant_id, ref) unique index.

    // seed tickets for both tenants as the privileged migration user
    const stamp = Date.now()
    await db
        .insertInto('tickets')
        .values([
            { tenant_id: alphaTenantId, ref: `PX-${stamp}-1`, subject: 'alpha ticket 1', body: 'alpha body 1' },
            { tenant_id: alphaTenantId, ref: `PX-${stamp}-2`, subject: 'alpha ticket 2', body: 'alpha body 2' },
            { tenant_id: demoTenantId, ref: `PX-${stamp}-3`, subject: 'demo ticket 1', body: 'demo body 1' },
        ])
        .execute()

    // read isolation, both directions, via UNFILTERED selects
    const alphaRows = await runWithTenant(db, alphaTenantId, (trx) => trx.selectFrom('tickets').selectAll().execute())
    expect(alphaRows.filter((r) => r.tenant_id === demoTenantId).length).toBe(0)
    expect(alphaRows.filter((r) => r.tenant_id === alphaTenantId).length).toBe(2)

    const demoRows = await runWithTenant(db, demoTenantId, (trx) => trx.selectFrom('tickets').selectAll().execute())
    expect(demoRows.filter((r) => r.tenant_id === alphaTenantId).length).toBe(0)
    expect(demoRows.filter((r) => r.tenant_id === demoTenantId).length).toBe(1)

    // negative control: WITHOUT SET LOCAL ROLE the privileged user bypasses RLS — proves the
    // isolation assertions above aren't passing vacuously
    const allRows = await db.selectFrom('tickets').selectAll().execute()
    expect(allRows.length >= 3).toBe(true)

    // fail-closed: role set, no tenant context -> zero rows (and no cast error)
    const noContext = await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL ROLE app_user`.execute(trx)
        return trx.selectFrom('tickets').selectAll().execute()
    })
    expect(noContext.length).toBe(0)

    // write isolation: INSERT carrying the other tenant's id is rejected by WITH CHECK
    let writeRejected = false
    try {
        await runWithTenant(db, alphaTenantId, (trx) =>
            trx
                .insertInto('tickets')
                .values({
                    tenant_id: demoTenantId,
                    ref: `PX-${stamp}-x`,
                    subject: 'smuggled',
                    body: 'smuggled',
                })
                .execute(),
        )
    } catch (error) {
        writeRejected = /row-level security/.test(String(error))
    }
    expect(writeRejected).toBe(true)

    // scoped writes succeed and are visible
    await runWithTenant(db, alphaTenantId, (trx) =>
        trx
            .insertInto('tickets')
            .values({
                tenant_id: alphaTenantId,
                ref: `PX-${stamp}-4`,
                subject: 'alpha ticket 3',
                body: 'alpha body 3',
            })
            .execute(),
    )
    const afterWrite = await runWithTenant(db, alphaTenantId, (trx) => trx.selectFrom('tickets').selectAll().execute())
    expect(afterWrite.filter((r) => r.tenant_id === alphaTenantId).length).toBe(3)

    // DELETE is granted on this table (unlike escalations/attachments), so prove the grant works AND
    // that the policy still contains it: an UNFILTERED delete under alpha's context removes alpha's
    // rows and leaves demo's untouched. This is the one place a granted DELETE is exercised, and the
    // assertion that matters is the SURVIVOR count on the other tenant.
    await runWithTenant(db, alphaTenantId, (trx) =>
        trx.deleteFrom('tickets').where('ref', '=', `PX-${stamp}-4`).execute(),
    )
    const afterDelete = await runWithTenant(db, alphaTenantId, (trx) => trx.selectFrom('tickets').selectAll().execute())
    expect(afterDelete.filter((r) => r.ref === `PX-${stamp}-4`).length).toBe(0)
    const demoSurvivors = await runWithTenant(db, demoTenantId, (trx) =>
        trx.selectFrom('tickets').select('ref').where('ref', '=', `PX-${stamp}-3`).execute(),
    )
    expect(demoSurvivors.length).toBe(1)

    // ---- escalations: tenant-only RLS, TWO-SIDED app-level org scoping, no-DELETE privilege ----
    //
    // This is the two-sided table's teaching artifact. The RLS boundary is STILL tenant-only (same policy shape as
    // tickets/jobs). The two org sides — requester and responder — are an APP-LEVEL filter that both the
    // real data module and these proofs express as `where(requester = X OR responder = X)`, NOT a
    // second RLS policy. So this section proves two independent guarantees at once: (1) the tenant RLS
    // still contains every row, and (2) the two-sided app filter returns the same row to BOTH parties
    // and to neither bystander.

    // Three alpha orgs: A raises, B responds, C is an uninvolved bystander in the same tenant.
    const [orgA] = await db
        .insertInto('organizations')
        .values({ tenant_id: alphaTenantId, slug: `req-a-${Date.now()}`, name: 'Req Org A' })
        .returning('id')
        .execute()
    const [orgB] = await db
        .insertInto('organizations')
        .values({ tenant_id: alphaTenantId, slug: `req-b-${Date.now()}`, name: 'Req Org B' })
        .returning('id')
        .execute()
    const [orgC] = await db
        .insertInto('organizations')
        .values({ tenant_id: alphaTenantId, slug: `req-c-${Date.now()}`, name: 'Req Org C' })
        .returning('id')
        .execute()

    // One request A -> B, seeded as the privileged migration user.
    const [reqAB] = await db
        .insertInto('escalations')
        .values({
            tenant_id: alphaTenantId,
            requester_org_id: orgA!.id,
            responder_org_id: orgB!.id,
            created_by_user_id: 'proof-user',
            subject: 'proof subject',
            body: 'proof body',
        })
        .returning('id')
        .execute()

    // (a) tenant isolation: alpha sees its request under RLS; demo sees zero (via UNFILTERED select).
    const alphaRequests = await runWithTenant(db, alphaTenantId, (trx) =>
        trx.selectFrom('escalations').selectAll().execute(),
    )
    expect(alphaRequests.filter((r) => r.tenant_id === alphaTenantId).length).toBe(1)
    const demoRequests = await runWithTenant(db, demoTenantId, (trx) =>
        trx.selectFrom('escalations').selectAll().execute(),
    )
    expect(demoRequests.length).toBe(0)

    // (a) write isolation: an INSERT carrying the OTHER tenant's id is rejected by WITH CHECK, even
    // though the org ids are valid alpha orgs — the tenant, not the org, is the RLS boundary.
    let requestWriteRejected = false
    try {
        await runWithTenant(db, alphaTenantId, (trx) =>
            trx
                .insertInto('escalations')
                .values({
                    tenant_id: demoTenantId,
                    requester_org_id: orgA!.id,
                    responder_org_id: orgB!.id,
                    created_by_user_id: 'proof-user',
                    subject: 'smuggled',
                    body: 'smuggled',
                })
                .execute(),
        )
    } catch (error) {
        requestWriteRejected = /row-level security/.test(String(error))
    }
    expect(requestWriteRejected).toBe(true)

    // (b) TWO-SIDED visibility — the heart of the slice. The SAME row is returned by the two-sided
    // filter for BOTH the requester (A) and the responder (B), and for NEITHER the bystander (C).
    const seenBy = (activeOrgId: string) =>
        runWithTenant(db, alphaTenantId, (trx) =>
            trx
                .selectFrom('escalations')
                .select('id')
                .where((eb) =>
                    eb.or([eb('requester_org_id', '=', activeOrgId), eb('responder_org_id', '=', activeOrgId)]),
                )
                .execute(),
        )
    const seenByA = await seenBy(orgA!.id)
    const seenByB = await seenBy(orgB!.id)
    const seenByC = await seenBy(orgC!.id)
    // The requester (A) and the responder (B) each see exactly the one shared row; C sees nothing.
    expect(seenByA.length === 1 && seenByA[0]!.id === reqAB!.id).toBe(true)
    expect(seenByB.length === 1 && seenByB[0]!.id === reqAB!.id).toBe(true)
    expect(seenByC.length).toBe(0)

    // (c) no-DELETE privilege guard: withdrawal is a soft UPDATE to 'cancelled', never a row delete.
    // As app_user, DELETE fails at the privilege layer (only SELECT, INSERT, UPDATE are granted) —
    // a request (and its audit trail) can never be erased.
    let requestDeleteRejected = false
    try {
        await db.transaction().execute(async (trx) => {
            await sql`SET LOCAL ROLE app_user`.execute(trx)
            await sql`SELECT set_config('app.current_tenant', ${alphaTenantId}, true)`.execute(trx)
            await sql`DELETE FROM escalations`.execute(trx)
        })
    } catch (error) {
        requestDeleteRejected = /permission denied/.test(String(error))
    }
    expect(requestDeleteRejected).toBe(true)

    // ...but an UPDATE of the status DOES succeed — the transition (respond/withdraw) is the only
    // write path, and it's granted.
    await runWithTenant(db, alphaTenantId, (trx) =>
        trx.updateTable('escalations').set({ status: 'accepted' }).where('id', '=', reqAB!.id).execute(),
    )
    const afterRespond = await runWithTenant(db, alphaTenantId, (trx) =>
        trx.selectFrom('escalations').select('status').where('id', '=', reqAB!.id).executeTakeFirstOrThrow(),
    )
    expect(afterRespond.status).toBe('accepted')

    // ---- attachments: tenant-only RLS, single-org app scoping, SELECT/INSERT/UPDATE (no DELETE) ----
    //
    // The typed upload table. Same tenant-only RLS shape as tickets/jobs; the single org is an
    // app-level filter, not an RLS anchor. Prove (a) tenant isolation both directions + WITH CHECK on
    // write, (b) UPDATE succeeds (the confirm path pending → ready), and (c) DELETE is denied at the
    // privilege layer (no grant this slice — mirrors the escalations no-DELETE guard). The shared
    // context supplies both orgs, so the cross-tenant WITH CHECK test carries a VALID org id on the
    // WRONG tenant.

    // One attachment under alpha's tenant + org, seeded as the privileged migration user.
    const [artAlpha] = await db
        .insertInto('attachments')
        .values({
            tenant_id: alphaTenantId,
            org_id: alphaOrgId,
            kind: 'attachment',
            filename: 'proof.txt',
            content_type: 'text/plain',
            storage_key: `attachments/${alphaTenantId}/proof/proof.txt`,
            uploaded_by_user_id: 'proof-user',
        })
        .returning('id')
        .execute()

    // (a) tenant isolation, both directions, via UNFILTERED selects under RLS.
    const alphaAttachments = await runWithTenant(db, alphaTenantId, (trx) =>
        trx.selectFrom('attachments').selectAll().execute(),
    )
    expect(alphaAttachments.filter((r) => r.tenant_id === demoTenantId).length).toBe(0)
    expect(alphaAttachments.filter((r) => r.tenant_id === alphaTenantId).length).toBe(1)
    const demoAttachments = await runWithTenant(db, demoTenantId, (trx) =>
        trx.selectFrom('attachments').selectAll().execute(),
    )
    expect(demoAttachments.length).toBe(0)

    // (a) write isolation: INSERT carrying the OTHER tenant's id is rejected by WITH CHECK, even with a
    // valid demo org id — the tenant, not the org, is the RLS boundary.
    let attachmentWriteRejected = false
    try {
        await runWithTenant(db, alphaTenantId, (trx) =>
            trx
                .insertInto('attachments')
                .values({
                    tenant_id: demoTenantId,
                    org_id: demoOrgId,
                    kind: 'attachment',
                    filename: 'smuggled.txt',
                    content_type: 'text/plain',
                    storage_key: 'attachments/smuggled/smuggled.txt',
                    uploaded_by_user_id: 'proof-user',
                })
                .execute(),
        )
    } catch (error) {
        attachmentWriteRejected = /row-level security/.test(String(error))
    }
    expect(attachmentWriteRejected).toBe(true)

    // (b) UPDATE succeeds — the confirm path (pending → ready, record the true size) is a granted write.
    await runWithTenant(db, alphaTenantId, (trx) =>
        trx
            .updateTable('attachments')
            .set({ status: 'ready', size_bytes: 11 })
            .where('id', '=', artAlpha!.id)
            .execute(),
    )
    const afterConfirm = await runWithTenant(db, alphaTenantId, (trx) =>
        trx
            .selectFrom('attachments')
            .select(['status', 'size_bytes'])
            .where('id', '=', artAlpha!.id)
            .executeTakeFirstOrThrow(),
    )
    expect(afterConfirm.status === 'ready' && afterConfirm.size_bytes === 11).toBe(true)

    // (c) DELETE denied at the privilege layer — only SELECT, INSERT, UPDATE are granted this slice.
    let attachmentDeleteRejected = false
    try {
        await db.transaction().execute(async (trx) => {
            await sql`SET LOCAL ROLE app_user`.execute(trx)
            await sql`SELECT set_config('app.current_tenant', ${alphaTenantId}, true)`.execute(trx)
            await sql`DELETE FROM attachments`.execute(trx)
        })
    } catch (error) {
        attachmentDeleteRejected = /permission denied/.test(String(error))
    }
    expect(attachmentDeleteRejected).toBe(true)

    // ---- the PAGED ticket queue: neither boundary moves when a cursor is involved ----
    //
    // The framework half proves a cursor cannot cross the TENANT boundary, which is the hostile one and
    // RLS's job. This half proves the second boundary the app adds on top — the team (ADR-0004,
    // an app-level WHERE, not a policy) — because that is the one a hand-rolled pager actually loses:
    // page one is built from the session and page two from the cursor, and the org filter is on the
    // first query only. There is no such second query here, and these assertions are what says so.
    //
    // Deliberately driven through the PRODUCTION function, `listTickets` — the same call GET
    // /api/tickets makes, cursor and all — rather than a re-derivation of it. A proof of a copy of the
    // read path proves nothing about the read path.

    const [pageOrgP] = await db
        .insertInto('organizations')
        .values({ tenant_id: alphaTenantId, slug: `page-p-${Date.now()}`, name: 'Page Org P' })
        .returning('id')
        .execute()
    const [pageOrgQ] = await db
        .insertInto('organizations')
        .values({ tenant_id: alphaTenantId, slug: `page-q-${Date.now()}`, name: 'Page Org Q' })
        .returning('id')
        .execute()

    // Six tickets for team P, three for team Q, three for the OTHER TENANT. Every row in a batch shares
    // ONE created_at, written explicitly at MICROSECOND precision — the two properties that break a
    // hand-rolled pager (no defined position inside a batch; a cursor truncated to a JS millisecond
    // that then excludes the batch it points into). The framework half explains both at length.
    const teamPAt = '2020-03-04T05:06:07.123456Z'
    const teamQAt = '2020-03-04T05:06:08.654321Z'
    const otherTenantAt = '2020-03-04T05:06:09.987654Z'
    await db
        .insertInto('tickets')
        .values(
            Array.from({ length: 6 }, (_, index) => ({
                tenant_id: alphaTenantId,
                org_id: pageOrgP!.id,
                ref: `KP-${stamp}-${index}`,
                subject: `page P ${index}`,
                body: 'p',
                created_at: teamPAt,
            })),
        )
        .execute()
    await db
        .insertInto('tickets')
        .values(
            Array.from({ length: 3 }, (_, index) => ({
                tenant_id: alphaTenantId,
                org_id: pageOrgQ!.id,
                ref: `KQ-${stamp}-${index}`,
                subject: `page Q ${index}`,
                body: 'q',
                created_at: teamQAt,
            })),
        )
        .execute()
    await db
        .insertInto('tickets')
        .values(
            Array.from({ length: 3 }, (_, index) => ({
                tenant_id: demoTenantId,
                org_id: demoOrgId,
                ref: `KD-${stamp}-${index}`,
                subject: `page D ${index}`,
                body: 'd',
                created_at: otherTenantAt,
            })),
        )
        .execute()

    /** Walk a team's queue to the end through the real read path, and report everything it showed. */
    const walkQueue = async (tenantId: string, orgId: string, limit: number) => {
        const seen: string[] = []
        let cursor: string | null = null
        for (let guard = 0; guard < 50; guard++) {
            const parsed = parseDbKeysetCursor(cursor)
            expect(parsed.kind === 'invalid').toBe(false)
            const page = await listTickets(dbPort, tenantId, orgId, { after: parsed.position ?? null, limit })
            seen.push(...page.tickets.map((ticket) => ticket.ref))
            if (page.nextCursor === null) return seen
            cursor = page.nextCursor
        }
        throw new Error('keyset proof: the queue walk did not terminate')
    }

    // (a) a full walk at a page size that cuts through the batch shows team P's six, once each, and no
    // sight of team Q's or of the other tenant's.
    const walkedP = await walkQueue(alphaTenantId, pageOrgP!.id, 2)
    expect(walkedP.length).toBe(6)
    expect(new Set(walkedP).size).toBe(6)
    expect(walkedP.every((ref) => ref.startsWith(`KP-${stamp}-`))).toBe(true)

    // (b) THE ATTACK on the team boundary: a cursor minted while paging team Q's queue, handed to team
    // P's. The two teams share a tenant, so RLS is not what stops this — the org filter is, and it is
    // re-applied because the pager rebuilds the whole query on every page rather than resuming one.
    const teamQPage = await listTickets(dbPort, alphaTenantId, pageOrgQ!.id, { after: null, limit: 1 })
    expect(teamQPage.nextCursor !== null).toBe(true)
    const parsedQ = parseDbKeysetCursor(teamQPage.nextCursor)
    const crossTeam = await listTickets(dbPort, alphaTenantId, pageOrgP!.id, {
        after: parsedQ.position ?? null,
        limit: 50,
    })
    expect(crossTeam.tickets.length).toBe(6)
    expect(crossTeam.tickets.some((ticket) => ticket.ref.startsWith(`KQ-${stamp}-`))).toBe(false)
    expect(crossTeam.tickets.every((ticket) => ticket.ref.startsWith(`KP-${stamp}-`))).toBe(true)

    // (c) the same attack across TENANTS, through the app's own read path this time: a cursor minted in
    // the demo tenant, replayed against alpha's queue. The tenant comes from withTenant, which the pager
    // opens from the caller's session — never from the cursor.
    const demoQueue = await listTickets(dbPort, demoTenantId, demoOrgId, { after: null, limit: 1 })
    expect(demoQueue.nextCursor !== null).toBe(true)
    const parsedDemo = parseDbKeysetCursor(demoQueue.nextCursor)
    const crossTenant = await listTickets(dbPort, alphaTenantId, pageOrgP!.id, {
        after: parsedDemo.position ?? null,
        limit: 50,
    })
    expect(crossTenant.tickets.length).toBe(6)
    expect(crossTenant.tickets.some((ticket) => ticket.ref.startsWith(`KD-${stamp}-`))).toBe(false)
    expect(crossTenant.tickets.every((ticket) => ticket.ref.startsWith(`KP-${stamp}-`))).toBe(true)

    // (d) a cursor crafted to name a REAL ticket belonging to the other team, at a timestamp that opens
    // the predicate as wide as it goes. Still exactly team P's six rows.
    const teamQFirst = teamQPage.tickets[0]
    expect(teamQFirst !== undefined).toBe(true)
    const craftedTeamCursor = encodeKeysetCursor({ at: '2999-01-01T00:00:00.000000Z', id: teamQFirst!.id })
    const crafted = await listTickets(dbPort, alphaTenantId, pageOrgP!.id, {
        after: parseKeysetCursor(craftedTeamCursor).position ?? null,
        limit: 50,
    })
    expect(crafted.tickets.length).toBe(6)
    expect(crafted.tickets.every((ticket) => ticket.ref.startsWith(`KP-${stamp}-`))).toBe(true)
}
