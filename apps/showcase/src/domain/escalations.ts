import { defineStateMachine } from 'keel/core/state-machine'

export const ESCALATION_STATUSES = ['open', 'accepted', 'rejected', 'cancelled'] as const
export type EscalationStatus = (typeof ESCALATION_STATUSES)[number]

/**
 * The escalation lifecycle. An escalation starts 'open' and reaches exactly one terminal state: the
 * receiving team accepts or rejects it, or the raising desk withdraws it (cancelled). All three
 * terminal states have no outgoing transitions — a decided escalation is immutable, so a late second
 * decision (double-accept, accept-after-cancel) is an InvalidTransitionError, not a silent overwrite.
 * Reuses the same defineStateMachine guard as jobs and tickets (ADR-0006 pure-core).
 *
 * Deliberately one-way, unlike ticketMachine: a ticket is working data that legitimately reopens; an
 * escalation is a RECORD OF A DECISION between two teams, and rewriting one after the fact would make
 * the outbound `escalation.decided` webhook a lie to whoever already received it.
 */
export const escalationMachine = defineStateMachine<EscalationStatus>({
    open: ['accepted', 'rejected', 'cancelled'],
    accepted: [],
    rejected: [],
    cancelled: [],
})

export function isEscalationStatus(value: string): value is EscalationStatus {
    return (ESCALATION_STATUSES as readonly string[]).includes(value)
}
