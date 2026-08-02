import { auth, db } from 'keel/adapters/index'
import { authorize } from 'keel/authz/authorize'
import { recordAuditEvent } from 'keel/db/audit'
import { escalationForActiveOrg, transitionEscalation } from '@/domain/db/escalations'
import { enqueueWebhookEvent } from 'keel/db/webhooks'
import { resolveOrgContext } from '../../../org-context'
import { withPortErrors } from '../../../respond'

/**
 * The raising desk withdraws its own escalation. 'delete' is the authorization verb (only a
 * non-restricted member of the REQUESTER side may withdraw), but the DB does a SOFT transition to
 * 'cancelled' — there is no DELETE grant on escalations, so the row and its audit trail survive
 * (migration 0006). The request must have the active org as a side (else 404, ids can't be probed);
 * withdrawing an already-decided request surfaces as 409 via withPortErrors.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
    return withPortErrors(async () => {
        const user = await auth.requireUser()
        const { id } = await context.params
        const resolved = await resolveOrgContext(user)
        if (resolved instanceof Response) return resolved
        const { tenantId, orgId: activeOrgId } = resolved

        const found = await escalationForActiveOrg(db, tenantId, activeOrgId, id)
        if (!found) return Response.json({ error: 'not found' }, { status: 404 })

        authorize(user, activeOrgId, 'delete', {
            type: 'Escalation',
            requesterOrgId: found.requesterOrgId,
            responderOrgId: found.responderOrgId,
        })

        await transitionEscalation(db, tenantId, id, 'cancelled', { byUserId: user.id })
        // Audit trail: recorded against the requester (active) side — the org that withdrew.
        await recordAuditEvent(db, {
            tenantId,
            orgId: activeOrgId,
            actorUserId: user.id,
            action: 'escalation.cancelled',
            subjectType: 'Escalation',
            subjectId: id,
        })
        // Outbound webhook: emit to the requester (active) org's endpoints — the org that withdrew.
        await enqueueWebhookEvent(db, {
            tenantId,
            orgId: activeOrgId,
            kind: 'escalation.decided',
            payload: {
                escalationId: id,
                decision: 'cancelled',
                requesterOrgId: found.requesterOrgId,
                responderOrgId: found.responderOrgId,
            },
        })
        return Response.json({ id, status: 'cancelled' })
    })
}
