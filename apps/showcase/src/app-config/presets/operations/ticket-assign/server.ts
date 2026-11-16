import { db } from 'keel/adapters/index'
import { NotFoundError } from 'keel/ports/errors'
import { resolvePresetOrg, type ServerPresetOperationHandler } from 'keel/server-lib/preset-operations'
import { ticketForOrg } from '@/domain/db/tickets'
import { applyTicketChanges } from '@/domain/ticket-changes'
import { people } from '@app/seed'
import type { TicketAssignArgs } from './definition'

/**
 * The SERVER half of `ticket.assign` (server-only: registered in `../../../preset-operations.ts`, never in
 * `../../../presets.ts`, which the static demo bundles). It calls the SAME named operation the PATCH
 * /api/tickets/[id] route calls — `applyTicketChanges` — after the same org-scoped lookup, so the write,
 * the `ticket.assigned` audit row and the assignee's notification are the route's own code. What it
 * skips is the route's `authorize(...)`: a preset has no session, and its kind's `check` asked the same
 * ability question at build time.
 */
export const ticketAssignServer: ServerPresetOperationHandler<TicketAssignArgs> = async (args, ctx) => {
    const actor = people.find((person) => person.id === args.by)
    if (!actor) throw new NotFoundError(`unknown person: ${args.by}`)
    const { tenantId, orgId } = await resolvePresetOrg(args.org)
    const ticket = await ticketForOrg(db, tenantId, orgId, ctx.refs.resolve(args.ticket))
    if (!ticket) throw new NotFoundError(`no ticket "${args.ticket}" in ${args.org}`)
    const updated = await applyTicketChanges(db, {
        tenantId,
        orgId,
        orgSlug: args.org,
        ticket,
        changes: { assigneeUserId: args.to },
        actor: { id: actor.id, name: actor.name },
    })
    if (!updated) throw new NotFoundError(`no ticket "${args.ticket}" in ${args.org}`)
}
