import { auth, db } from 'keel/adapters/index'
import { authorize } from 'keel/authz/authorize'
import { recordAuditEvent } from 'keel/db/audit'
import { notifyMember } from 'keel/server-lib/notify'
import { makeNotifyDeps } from 'keel/server-lib/notify-deps'
import { deleteTicket, ticketForOrg, updateTicket } from '@/domain/db/tickets'
import { isTicketStatus } from '@/domain/tickets'
import { resolveOrgContext } from '../../org-context'
import { withPortErrors } from '../../respond'

/**
 * Editing and closing a ticket — the two routes the ability model has always described and nothing
 * could reach. `Ticket: update|delete` rules existed from the day the subject was registered, with no
 * HTTP surface behind them; an ability rule with no route is a rule nobody has ever exercised.
 *
 * PATCH changes status and/or assignee. DELETE removes the ticket (a real delete: the tickets table is
 * the one app table granted DELETE — see migration 1001). Both resolve the row ORG-SCOPED first, so a
 * ticket belonging to another team is indistinguishable from a missing one and ids cannot be probed
 * (the jobForOrg doctrine), and both re-authorize with the row's real org id rather than a slug anchor.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
    return withPortErrors(async () => {
        const { id } = await context.params
        const user = await auth.requireUser()
        const payload = (await request.json()) as { status?: unknown; assigneeUserId?: unknown }

        // Validate at the boundary, explicitly, before anything is resolved: an unknown status is a
        // 400, not a state machine surprise later.
        const changes: { status?: 'open' | 'pending' | 'resolved'; assigneeUserId?: string | null } = {}
        if (payload.status !== undefined) {
            if (typeof payload.status !== 'string' || !isTicketStatus(payload.status)) {
                return Response.json({ error: 'unknown-status' }, { status: 400 })
            }
            changes.status = payload.status
        }
        if (payload.assigneeUserId !== undefined) {
            if (payload.assigneeUserId !== null && typeof payload.assigneeUserId !== 'string') {
                return Response.json({ error: 'invalid-assignee' }, { status: 400 })
            }
            changes.assigneeUserId = payload.assigneeUserId
        }
        if (changes.status === undefined && changes.assigneeUserId === undefined) {
            return Response.json({ error: 'nothing-to-change' }, { status: 400 })
        }

        const resolved = await resolveOrgContext(user)
        if (resolved instanceof Response) return resolved
        const { tenantId, orgId } = resolved

        const before = await ticketForOrg(db, tenantId, orgId, id)
        if (!before) return Response.json({ error: 'not found' }, { status: 404 })

        // Authorization choke point: a restricted member may read the queue but not change it.
        authorize(user, orgId, 'update', { type: 'Ticket', orgId })

        // An illegal status hop (open → open, or anything the machine forbids) throws
        // InvalidTransitionError inside the transaction → 409 via withPortErrors, and no row is written.
        const ticket = await updateTicket(db, tenantId, orgId, id, changes)
        if (!ticket) return Response.json({ error: 'not found' }, { status: 404 })

        const reassigned = changes.assigneeUserId !== undefined && changes.assigneeUserId !== before.assigneeUserId
        await recordAuditEvent(db, {
            tenantId,
            orgId,
            actorUserId: user.id,
            // Two verbs, because "who did this ticket get handed to" is a question an audit log should
            // answer without the reader diffing payloads.
            action: reassigned ? 'ticket.assigned' : 'ticket.updated',
            subjectType: 'Ticket',
            subjectId: ticket.id,
        })

        // Notification fan-out: being handed a ticket is news for the ASSIGNEE, not for the team's
        // admins — the registry's second recipient shape. Claiming a ticket yourself notifies nobody
        // (excludeUserId), and unassigning notifies nobody either. After-commit, like every emission.
        if (reassigned && ticket.assigneeUserId) {
            await notifyMember(await makeNotifyDeps(), {
                members: await auth.listMembers(user.orgSlug),
                tenantId,
                orgId,
                recipientUserId: ticket.assigneeUserId,
                excludeUserId: user.id,
                kind: 'ticket.assigned',
                payload: {
                    ticketId: ticket.id,
                    ref: ticket.ref,
                    subject: ticket.subject,
                    assignedByName: user.name,
                },
            })
        }
        return Response.json({ ticket })
    })
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
    return withPortErrors(async () => {
        const { id } = await context.params
        const user = await auth.requireUser()
        const resolved = await resolveOrgContext(user)
        if (resolved instanceof Response) return resolved
        const { tenantId, orgId } = resolved

        const ticket = await ticketForOrg(db, tenantId, orgId, id)
        if (!ticket) return Response.json({ error: 'not found' }, { status: 404 })

        authorize(user, orgId, 'delete', { type: 'Ticket', orgId })

        const removed = await deleteTicket(db, tenantId, orgId, id)
        if (removed === 0) return Response.json({ error: 'not found' }, { status: 404 })
        // The audit event OUTLIVES the row — which is the whole reason the audit log is its own table.
        // Recorded after the delete commits, so it can only ever describe something that happened.
        await recordAuditEvent(db, {
            tenantId,
            orgId,
            actorUserId: user.id,
            action: 'ticket.deleted',
            subjectType: 'Ticket',
            subjectId: id,
        })
        return Response.json({ deleted: id })
    })
}
