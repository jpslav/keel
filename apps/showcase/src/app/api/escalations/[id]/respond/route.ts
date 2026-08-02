import { auth, db } from 'keel/adapters/index'
import { authorize } from 'keel/authz/authorize'
import { recordAuditEvent } from 'keel/db/audit'
import { escalationForActiveOrg, transitionEscalation } from '@/domain/db/escalations'
import { enqueueWebhookEvent } from 'keel/db/webhooks'
import { resolveOrgContext } from '../../../org-context'
import { withPortErrors } from '../../../respond'

/**
 * The receiving team decides an escalation (accept/reject). The request must have the active org
 * as one of its two sides — a foreign request is indistinguishable from a missing one (404), so ids
 * can't be probed (the jobForOrg doctrine). Only an org MANAGER on the RESPONDER side may respond
 * (authorize with the row's REAL org ids). The transition is validated by the state machine; deciding
 * an already-decided request (double-accept, accept-after-cancel) surfaces as 409 via withPortErrors.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
    return withPortErrors(async () => {
        const user = await auth.requireUser()
        const { id } = await context.params
        const { decision } = (await request.json()) as { decision?: string }
        if (decision !== 'accept' && decision !== 'reject') {
            return Response.json({ error: 'invalid-decision' }, { status: 400 })
        }
        const resolved = await resolveOrgContext(user)
        if (resolved instanceof Response) return resolved
        const { tenantId, orgId: activeOrgId } = resolved

        const found = await escalationForActiveOrg(db, tenantId, activeOrgId, id)
        if (!found) return Response.json({ error: 'not found' }, { status: 404 })

        authorize(user, activeOrgId, 'update', {
            type: 'Escalation',
            requesterOrgId: found.requesterOrgId,
            responderOrgId: found.responderOrgId,
        })

        const next = decision === 'accept' ? 'accepted' : 'rejected'
        await transitionEscalation(db, tenantId, id, next, { byUserId: user.id })
        // Audit trail: recorded against the responder (active) side — the org that decided.
        await recordAuditEvent(db, {
            tenantId,
            orgId: activeOrgId,
            actorUserId: user.id,
            action: decision === 'accept' ? 'escalation.accepted' : 'escalation.rejected',
            subjectType: 'Escalation',
            subjectId: id,
        })
        // Outbound webhook: emit to the responder (active) org's endpoints — the org that decided.
        await enqueueWebhookEvent(db, {
            tenantId,
            orgId: activeOrgId,
            kind: 'escalation.decided',
            payload: {
                escalationId: id,
                decision: next,
                requesterOrgId: found.requesterOrgId,
                responderOrgId: found.responderOrgId,
            },
        })
        return Response.json({ id, status: next })
    })
}
