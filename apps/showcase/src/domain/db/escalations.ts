import { sql } from 'kysely'
import { toIso } from 'keel/db/jobs'
import { type EscalationStatus, escalationMachine } from '@/domain/escalations'
import type { DbPort } from 'keel/ports/db'

/** An escalation as either party sees it in their list. The caller derives direction. */
interface EscalationView {
    id: string
    subject: string
    body: string
    status: EscalationStatus
    requesterOrgName: string
    responderOrgName: string
    createdAt: string
}

/** Both sides of the active org's requests, each newest-first. Direction is by which side the org is. */
export interface EscalationLists {
    sent: EscalationView[]
    received: EscalationView[]
}

/**
 * Raises an escalation: one tenant-scoped INSERT. Both org ids are the caller's already-resolved
 * uuids (the route resolves the responder slug and derives the requester from the session), and RLS
 * pins tenant_id — so a request can never be planted into another tenant. The self-directed case is
 * rejected upstream (route 400) and by the table CHECK; it never reaches here.
 */
export async function createEscalation(
    db: DbPort,
    input: {
        tenantId: string
        requesterOrgId: string
        responderOrgId: string
        createdByUserId: string
        subject: string
        body: string
    },
): Promise<{ id: string }> {
    return db.withTenant(input.tenantId, (trx) =>
        trx
            .insertInto('escalations')
            .values({
                tenant_id: input.tenantId,
                requester_org_id: input.requesterOrgId,
                responder_org_id: input.responderOrgId,
                created_by_user_id: input.createdByUserId,
                subject: input.subject,
                body: input.body,
            })
            .returning('id')
            .executeTakeFirstOrThrow(),
    )
}

/**
 * THE choke point for every request transition (respond / withdraw). One tenant-scoped transaction
 * locks the row (FOR UPDATE so two concurrent decisions serialize instead of double-writing), asserts
 * the hop is legal (an illegal one — double-accept, accept-after-cancel — throws InvalidTransitionError
 * and rolls back), then updates status + updated_at and records who acted (decided_by_user_id). The
 * authorization that a given actor MAY perform this transition happens in the route before this call;
 * this guard is purely about the lifecycle being legal.
 */
export async function transitionEscalation(
    db: DbPort,
    tenantId: string,
    escalationId: string,
    next: EscalationStatus,
    opts: { byUserId: string },
): Promise<void> {
    await db.withTenant(tenantId, async (trx) => {
        const current = await trx
            .selectFrom('escalations')
            .select('status')
            .where('id', '=', escalationId)
            .forUpdate()
            .executeTakeFirstOrThrow()
        escalationMachine.assertTransition(current.status as EscalationStatus, next)
        await trx
            .updateTable('escalations')
            .set({ status: next, updated_at: sql`now()`, decided_by_user_id: opts.byUserId })
            .where('id', '=', escalationId)
            .execute()
    })
}

/**
 * Resolves a request id to its status + both sides ONLY when the active org is one of the two parties
 * — returns null both when the request is absent and when the active org is a bystander (a foreign
 * request must be indistinguishable from a missing one, so ids can't be probed; the jobForOrg
 * doctrine). The route uses the returned side ids to authorize with the REAL org ids.
 */
export async function escalationForActiveOrg(
    db: DbPort,
    tenantId: string,
    activeOrgId: string,
    escalationId: string,
): Promise<{ id: string; status: EscalationStatus; requesterOrgId: string; responderOrgId: string } | null> {
    return db.withTenant(tenantId, async (trx) => {
        const row = await trx
            .selectFrom('escalations')
            .select(['id', 'status', 'requester_org_id', 'responder_org_id'])
            .where('id', '=', escalationId)
            .where((eb) => eb.or([eb('requester_org_id', '=', activeOrgId), eb('responder_org_id', '=', activeOrgId)]))
            .executeTakeFirst()
        return row
            ? {
                  id: row.id,
                  status: row.status as EscalationStatus,
                  requesterOrgId: row.requester_org_id,
                  responderOrgId: row.responder_org_id,
              }
            : null
    })
}

/**
 * Lists the active org's escalations, split by direction. The two-sided filter — the heart of
 * the slice — is `where(requester = X OR responder = X)`: an app-level org scope layered on top of the
 * tenant RLS (0006's doc comment). Every returned row has the active org on exactly one side (the
 * table CHECK guarantees the sides differ), so 'sent' vs 'received' is an unambiguous partition. Org
 * names come from a double self-join on the RLS-free organizations table.
 */
export async function listEscalations(db: DbPort, tenantId: string, activeOrgId: string): Promise<EscalationLists> {
    return db.withTenant(tenantId, async (trx) => {
        const rows = await trx
            .selectFrom('escalations')
            .innerJoin('organizations as requester_org', 'requester_org.id', 'escalations.requester_org_id')
            .innerJoin('organizations as responder_org', 'responder_org.id', 'escalations.responder_org_id')
            .select([
                'escalations.id as id',
                'escalations.subject as subject',
                'escalations.body as body',
                'escalations.status as status',
                'escalations.requester_org_id as requesterOrgId',
                'escalations.created_at as createdAt',
                'requester_org.name as requesterOrgName',
                'responder_org.name as responderOrgName',
            ])
            .where((eb) =>
                eb.or([
                    eb('escalations.requester_org_id', '=', activeOrgId),
                    eb('escalations.responder_org_id', '=', activeOrgId),
                ]),
            )
            .orderBy('escalations.created_at', 'desc')
            .execute()

        const sent: EscalationView[] = []
        const received: EscalationView[] = []
        for (const row of rows) {
            const view: EscalationView = {
                id: row.id,
                subject: row.subject,
                body: row.body,
                status: row.status as EscalationStatus,
                requesterOrgName: row.requesterOrgName,
                responderOrgName: row.responderOrgName,
                createdAt: toIso(row.createdAt),
            }
            if (row.requesterOrgId === activeOrgId) sent.push(view)
            else received.push(view)
        }
        return { sent, received }
    })
}
