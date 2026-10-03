import { defineAbilitiesFor } from 'keel/core/abilities'
import type { PresetOperationDefinition, PresetOperationOf } from 'keel/core/presets'
import { isRole } from 'keel/core/roles'
import * as v from 'valibot'
import { staffOrgSlug } from '../../../abilities'

/**
 * `ticket.assign` — the desk's own demo-preset operation kind: `by` hands a ticket in `org` to `to`, as
 * the ticket card's assignee picker does. This is the DEFINITION third (pure, so the static demo may
 * bundle it — keel/core/presets.ts explains the three parts); `./server.ts` and `./static.ts` are the
 * halves that do it.
 *
 * `ticket` is not an id: it is the NAME an earlier step bound with `as` (the morning's refund email, in
 * `mid-demo`). Ids differ per host and per replay, names do not.
 */
export interface TicketAssignArgs {
    /** A seed person who may update tickets in `org`. */
    by: string
    org: string
    /** A named result (`as`) of an earlier operation that opened a ticket in `org`. */
    ticket: string
    /** A seed person who is a member of `org`. */
    to: string
}

export type TicketAssignOperation = PresetOperationOf<'ticket.assign', TicketAssignArgs>

export const ticketAssign: PresetOperationDefinition<'ticket.assign', TicketAssignArgs> = {
    kind: 'ticket.assign',
    args: v.object({ by: v.string(), org: v.string(), ticket: v.string(), to: v.string() }),
    check(args, world, earlier) {
        const problems: string[] = []
        if (!world.orgSlugs.includes(args.org)) problems.push(`unknown org "${args.org}"`)
        // The SAME question the PATCH route's authorize(user, orgId, 'update', Ticket) asks, through the
        // same pure ability rules, for an actor acting in `org` (and holding manage-all there only if
        // `org` is the staff org, as abilityActorFromUser derives it).
        const actor = world.people.find((person) => person.id === args.by)
        const role = actor?.memberships.find((m) => m.orgSlug === args.org)?.role
        if (!actor) problems.push(`"${args.by}" is not a seed person`)
        else if (
            role === undefined ||
            !isRole(role) ||
            !defineAbilitiesFor({
                userId: actor.id,
                role,
                restricted: actor.restricted,
                activeOrgId: args.org,
                manageAll: args.org === staffOrgSlug,
            }).can('update', { type: 'Ticket', orgId: args.org })
        ) {
            problems.push(`"${args.by}" may not update tickets in "${args.org}"`)
        }
        const assignee = world.people.find((person) => person.id === args.to)
        if (!assignee) problems.push(`assignee "${args.to}" is not a seed person`)
        else if (!assignee.memberships.some((m) => m.orgSlug === args.org)) {
            problems.push(`assignee "${args.to}" is not a member of "${args.org}"`)
        }
        // The named ticket must be one this team's queue holds: the halves look it up org-scoped, as
        // the route does, so a ticket opened in another team would be "not found" at replay.
        const producer = earlier.find((operation) => operation.as === args.ticket)
        if (producer && 'org' in producer && producer.org !== args.org) {
            problems.push(`"${args.ticket}" was opened in "${producer.org}", not "${args.org}"`)
        }
        return problems
    },
    consumes: (args) => [args.ticket],
}
