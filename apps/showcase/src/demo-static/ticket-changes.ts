import type { DemoWorld } from 'keel/demo-static/contracts'
import type { Dispatch, SetStateAction } from 'react'
import { type TicketStatus, ticketMachine } from '../domain/tickets'

/** In-memory twin of a tickets row — tenant+org scoped, so the static dashboard shows only the active
 *  team's queue (no cross-tenant leakage) and can gate create/update/delete by the same pure ability
 *  model the real server runs. Tickets are just rows, so this is genuine parity, not a degrade. */
export interface DemoTicket {
    id: string
    tenantSlug: string
    orgSlug: string
    ref: string
    subject: string
    body: string
    status: TicketStatus
    assigneeUserId: string | null
    createdAt: string
}

/** Where a ticket edit's side effects go — the composition root's own setter, plus an audit recorder and
 *  the world's notification twin. The CALLER binds the audit's tenant and team: the UI to the ones being
 *  looked at, a preset step to the ones it names. */
export interface DemoTicketEffects {
    setTickets: Dispatch<SetStateAction<DemoTicket[]>>
    recordAudit: (entry: { action: string; subjectType: 'Ticket'; subjectId: string; actorUserId: string }) => void
    notifyMemberOf: DemoWorld['notifyMemberOf']
}

/**
 * Twin of `applyTicketChanges` (../domain/ticket-changes.ts): THE ticket edit, once it is allowed — the
 * write, the audit verb, the assignee's notification. Both the ticket card's `onUpdate` (./app.tsx) and the
 * `ticket.assign` preset step (src/app-config/presets/operations/ticket-assign/static.ts) call it, so the
 * two cannot drift, exactly as the route and the server half share the real one.
 *
 * The lookup is org-scoped (the twin of ticketForOrg), and the actor is explicit — whoever the caller says
 * acted, never the signed-in person read from in here. An illegal status hop is a refused no-op, like the
 * server's 409: nothing is written and the audit trail says nothing happened. Returns the updated ticket,
 * or null when the team has no such ticket or the hop was refused.
 */
export function applyDemoTicketChanges(
    tickets: readonly DemoTicket[],
    edit: {
        ticketId: string
        orgSlug: string
        changes: { status?: TicketStatus; assigneeUserId?: string | null }
        actor: { id: string; name: string }
    },
    effects: DemoTicketEffects,
): DemoTicket | null {
    const { ticketId, orgSlug, changes, actor } = edit
    const target = tickets.find((t) => t.id === ticketId && t.orgSlug === orgSlug)
    if (!target) return null
    if (changes.status && !ticketMachine.canTransition(target.status, changes.status)) return null

    const apply = (ticket: DemoTicket): DemoTicket => ({
        ...ticket,
        status: changes.status ?? ticket.status,
        assigneeUserId: changes.assigneeUserId !== undefined ? changes.assigneeUserId : ticket.assigneeUserId,
    })
    effects.setTickets((prev) => prev.map((t) => (t.id === target.id ? apply(t) : t)))

    const reassigned = changes.assigneeUserId !== undefined && changes.assigneeUserId !== target.assigneeUserId
    effects.recordAudit({
        action: reassigned ? 'ticket.assigned' : 'ticket.updated',
        subjectType: 'Ticket',
        subjectId: target.id,
        actorUserId: actor.id,
    })
    // Being handed a ticket notifies the ASSIGNEE, not the team's admins — the same recipient decision the
    // server makes, and self-assignment notifies nobody.
    if (reassigned && changes.assigneeUserId) {
        effects.notifyMemberOf(
            orgSlug,
            changes.assigneeUserId,
            'ticket.assigned',
            { ticketId: target.id, ref: target.ref, subject: target.subject, assignedByName: actor.name },
            actor.id,
        )
    }
    return apply(target)
}
