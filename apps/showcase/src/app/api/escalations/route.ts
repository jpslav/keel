import { auth, db } from 'keel/adapters/index'
import { authorize } from 'keel/authz/authorize'
import { recordAuditEvent } from 'keel/db/audit'
import { createEscalation, listEscalations } from '@/domain/db/escalations'
import { listOrgsInTenant, orgForId, orgIdForSlug } from 'keel/db/org-lookup'
import { enqueueWebhookEvent } from 'keel/db/webhooks'
import { notifyAdmins } from 'keel/server-lib/notify'
import { makeNotifyDeps } from 'keel/server-lib/notify-deps'
import { resolveOrgContext } from '../org-context'
import { withPortErrors } from '../respond'

/**
 * Escalations — one desk handing work to another team. Like tickets, every row is tenant-scoped by RLS;
 * UNLIKE tickets, the org filter is TWO-SIDED: an escalation is visible to BOTH the desk that raised it
 * and the team it was handed to (an app-level `requester = X OR responder = X`, ADR-0004 /
 * migration 1002). The list also returns the tenant's OTHER teams as escalation targets — you cannot
 * escalate to yourself.
 */
export async function GET(): Promise<Response> {
    return withPortErrors(async () => {
        const user = await auth.requireUser()
        const resolved = await resolveOrgContext(user)
        if (resolved instanceof Response) return resolved
        const { tenantId, orgId: activeOrgId } = resolved

        const { sent, received } = await listEscalations(db, tenantId, activeOrgId)
        const targets = (await listOrgsInTenant(db, tenantId))
            .filter((org) => org.id !== activeOrgId)
            .map((org) => ({ slug: org.slug, name: org.name }))
        return Response.json({ sent, received, targets })
    })
}

export async function POST(request: Request): Promise<Response> {
    return withPortErrors(async () => {
        const user = await auth.requireUser()
        const { responderOrgSlug, subject, body } = (await request.json()) as {
            responderOrgSlug?: string
            subject?: string
            body?: string
        }
        if (!responderOrgSlug || !subject?.trim() || !body?.trim()) {
            return Response.json({ error: 'invalid-request' }, { status: 400 })
        }
        const resolved = await resolveOrgContext(user)
        if (resolved instanceof Response) return resolved
        const { tenantId, orgId: requesterOrgId } = resolved
        // A self-directed request is rejected here first (the table CHECK is only the backstop). Compare
        // BOTH the slug and the resolved id so a caller can't slip past by naming their own org.
        if (responderOrgSlug === user.orgSlug) return Response.json({ error: 'self-request' }, { status: 400 })
        const responderOrgId = await orgIdForSlug(db, tenantId, responderOrgSlug)
        if (!responderOrgId) return Response.json({ error: 'unknown responder org' }, { status: 404 })
        if (responderOrgId === requesterOrgId) return Response.json({ error: 'self-request' }, { status: 400 })

        // Authorization choke point: only a non-restricted member of the REQUESTER
        // side may raise a request. Enforced with the real resolved org ids — never a slug anchor.
        authorize(user, requesterOrgId, 'create', { type: 'Escalation', requesterOrgId, responderOrgId })

        const { id } = await createEscalation(db, {
            tenantId,
            requesterOrgId,
            responderOrgId,
            createdByUserId: user.id,
            subject: subject.trim(),
            body: body.trim(),
        })
        // Audit trail: recorded against the requester side — the org that took the action.
        await recordAuditEvent(db, {
            tenantId,
            orgId: requesterOrgId,
            actorUserId: user.id,
            action: 'escalation.created',
            subjectType: 'Escalation',
            subjectId: id,
        })
        // Outbound webhook: emit to the requester org's endpoints — the org that acted.
        await enqueueWebhookEvent(db, {
            tenantId,
            orgId: requesterOrgId,
            kind: 'escalation.created',
            payload: { escalationId: id, subject: subject.trim(), requesterOrgId, responderOrgId },
        })
        // Notification fan-out: tell the TARGET (responder) team's admins a request landed —
        // the demo's headline flow (the other team's bell rises). Notification is org-scoped to the
        // responder org (the recipients' team); after-commit, beside the audit + webhook emissions.
        const responderMembers = await auth.listMembers(responderOrgSlug)
        const requesterOrg = await orgForId(db, requesterOrgId)
        await notifyAdmins(await makeNotifyDeps(), {
            members: responderMembers,
            tenantId,
            orgId: responderOrgId,
            kind: 'escalation.received',
            payload: {
                escalationId: id,
                subject: subject.trim(),
                requesterOrgName: requesterOrg?.name ?? user.orgSlug,
            },
        })
        return Response.json({ id }, { status: 201 })
    })
}
