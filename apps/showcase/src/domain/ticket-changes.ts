import { auth } from 'keel/adapters/index'
import { recordAuditEvent } from 'keel/db/audit'
import type { DbPort } from 'keel/ports/db'
import { notifyMember } from 'keel/server-lib/notify'
import { makeNotifyDeps } from 'keel/server-lib/notify-deps'
import { type TicketView, updateTicket } from '@/domain/db/tickets'
import type { TicketStatus } from '@/domain/tickets'

/** What a ticket edit may change. `assigneeUserId` is three-state: absent = leave alone, null = unassign. */
export interface TicketChanges {
    status?: TicketStatus
    assigneeUserId?: string | null
}

/**
 * THE ticket edit, once it is allowed: the write, the audit verb, and the assignee's notification — named
 * so that every caller that edits a ticket does all three the same way. Two call it today: PATCH
 * /api/tickets/[id] (a person at the desk) and the `ticket.assign` demo-preset operation
 * (src/app-config/presets/operations/ticket-assign/server.ts, a scripted step). That is the pattern for
 * product code a preset wants to drive — an OPERATION the route and the script both call, not an event
 * bus between them — and it is why the two cannot drift: there is one body.
 *
 * What it does NOT do is decide whether the edit may happen. The caller has already validated the input,
 * resolved `ticket` ORG-SCOPED (`ticketForOrg`, so another team's ticket is indistinguishable from a
 * missing one) and authorized the actor — the route with `authorize(...)`, a preset at build time through
 * its kind's `check`. `actor` is explicit for the same reason: it is whoever the CALLER says acted, never
 * read from a session in here.
 *
 * An illegal status hop throws InvalidTransitionError from `updateTicket`, before anything is written or
 * sent (the route turns it into a 409). Returns the updated ticket, or null if the row vanished between
 * the caller's lookup and the write.
 */
export async function applyTicketChanges(
    db: DbPort,
    input: {
        tenantId: string
        orgId: string
        orgSlug: string
        /** The ticket as the caller resolved it, org-scoped, BEFORE the change. */
        ticket: TicketView
        changes: TicketChanges
        actor: { id: string; name: string }
    },
): Promise<TicketView | null> {
    const { tenantId, orgId, orgSlug, changes, actor } = input
    const ticket = await updateTicket(db, tenantId, orgId, input.ticket.id, changes)
    if (!ticket) return null

    const reassigned = changes.assigneeUserId !== undefined && changes.assigneeUserId !== input.ticket.assigneeUserId
    await recordAuditEvent(db, {
        tenantId,
        orgId,
        actorUserId: actor.id,
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
            members: await auth.listMembers(orgSlug),
            tenantId,
            orgId,
            recipientUserId: ticket.assigneeUserId,
            excludeUserId: actor.id,
            kind: 'ticket.assigned',
            payload: {
                ticketId: ticket.id,
                ref: ticket.ref,
                subject: ticket.subject,
                assignedByName: actor.name,
            },
        })
    }
    return ticket
}
