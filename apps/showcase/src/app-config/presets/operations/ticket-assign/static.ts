import type { StaticPresetOperationHandler } from 'keel/demo-static/contracts'
import { applyDemoTicketChanges, type DemoTicket, type DemoTicketEffects } from '@/demo-static/ticket-changes'
import { findOrg } from '@app/seed'
import type { TicketAssignArgs } from './definition'

/**
 * The STATIC half of `ticket.assign`, for the `file://` demo's in-memory world: the twin of `./server.ts`,
 * calling the twin of the route's operation (`applyDemoTicketChanges`) as the step's EXPLICIT actor in its
 * EXPLICIT team — the audit and notification go through the replay's context, never through the
 * signed-in person. A factory, because the tickets are the composition root's own state: it hands over
 * this render's rows and setter (src/demo-static/app.tsx `presetOperations`).
 */
export function ticketAssignStatic(desk: {
    tickets: readonly DemoTicket[]
    setTickets: DemoTicketEffects['setTickets']
}): StaticPresetOperationHandler<TicketAssignArgs> {
    return (args, ctx) => {
        const actor = ctx.findPerson(args.by)
        const org = findOrg(args.org)
        if (!actor || !org) return false
        const updated = applyDemoTicketChanges(
            desk.tickets,
            {
                ticketId: ctx.refs.resolve(args.ticket),
                orgSlug: org.slug,
                changes: { assigneeUserId: args.to },
                actor: { id: actor.id, name: actor.name },
            },
            {
                setTickets: desk.setTickets,
                recordAudit: (entry) => ctx.recordAudit(entry, { tenantSlug: org.tenantSlug, orgSlug: org.slug }),
                notifyMemberOf: ctx.notifyMemberOf,
            },
        )
        return updated ? {} : false
    }
}
