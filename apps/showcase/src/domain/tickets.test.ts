import { describe, expect, test } from 'vitest'
import { InvalidTransitionError } from 'keel/core/state-machine'
import { isSlaBreached, isTicketStatus, nextTicketRef, TICKET_SLA_HOURS, ticketMachine } from './tickets'

/**
 * The ticket's PURE rules. These four functions are shared verbatim by the server routes, the
 * inbound-email handlers and the static-demo twin, so pinning them here is what stops "what a ticket
 * is" drifting between the three (../domain/tickets.ts's opening claim).
 */

const HOUR_MS = 3_600_000
const NOW = Date.parse('2026-07-31T12:00:00.000Z')
const hoursAgo = (n: number) => new Date(NOW - n * HOUR_MS).toISOString()

describe('ticketMachine', () => {
    test('allows the round trip a desk actually walks', () => {
        for (const [from, to] of [
            ['open', 'pending'],
            ['open', 'resolved'],
            ['pending', 'open'],
            ['pending', 'resolved'],
            // Not one-way, unlike the escalation machine: a customer replying reopens a resolved ticket.
            ['resolved', 'open'],
        ] as const) {
            expect(ticketMachine.canTransition(from, to), `${from} -> ${to}`).toBe(true)
        }
    })

    test('refuses a no-op hop, so a PATCH that changes nothing is a 409 rather than a silent audit event', () => {
        for (const state of ['open', 'pending', 'resolved'] as const) {
            expect(ticketMachine.canTransition(state, state), state).toBe(false)
            expect(() => ticketMachine.assertTransition(state, state)).toThrow(InvalidTransitionError)
        }
    })

    test('refuses resolved -> pending: a closed ticket reopens, it does not go back to waiting', () => {
        expect(ticketMachine.canTransition('resolved', 'pending')).toBe(false)
    })

    test('no state is terminal — every ticket can always move somewhere', () => {
        for (const state of ticketMachine.states) expect(ticketMachine.isTerminal(state), state).toBe(false)
    })
})

describe('isTicketStatus', () => {
    test('accepts exactly the three statuses', () => {
        for (const status of ['open', 'pending', 'resolved']) expect(isTicketStatus(status)).toBe(true)
        for (const status of ['OPEN', 'closed', 'done', '', 'open ']) expect(isTicketStatus(status), status).toBe(false)
    })
})

describe('nextTicketRef', () => {
    test('continues the series one past the highest number issued', () => {
        expect(nextTicketRef(['NW-1041'], 'northwind')).toBe('NW-1042')
    })

    test('reads the highest number, not the last element', () => {
        expect(nextTicketRef(['NW-3', 'NW-1041', 'NW-77'], 'northwind')).toBe('NW-1042')
    })

    test('starts a brand-new queue from the slug, so a fresh site needs no configuration', () => {
        expect(nextTicketRef([], 'northwind')).toBe('NO-1')
    })

    test('strips non-letters from the slug before taking its first two', () => {
        expect(nextTicketRef([], 'acme-2')).toBe('AC-1')
        expect(nextTicketRef([], '4th-street')).toBe('TH-1')
    })

    test('falls back to T when a slug carries no letters at all', () => {
        expect(nextTicketRef([], '2026')).toBe('T-1')
        expect(nextTicketRef([], '')).toBe('T-1')
    })

    test('ignores unparseable refs rather than letting them reset the series', () => {
        expect(nextTicketRef(['not-a-ref', 'NW-9', 'nw-500', 'NW-'], 'northwind')).toBe('NW-10')
    })

    test('falls back to the slug when NOTHING in the queue parses', () => {
        expect(nextTicketRef(['legacy/1', 'legacy/2'], 'northwind')).toBe('NO-1')
    })

    test('a mixed-prefix queue follows the highest NUMBER, prefix and all (see the docstring)', () => {
        // Deliberate, and documented: the number must never go backwards, so the prefix travels with it.
        expect(nextTicketRef(['AB-9999', 'NW-1041'], 'northwind')).toBe('AB-10000')
    })
})

describe('isSlaBreached', () => {
    test('an unresolved ticket older than the SLA is late', () => {
        expect(isSlaBreached('open', hoursAgo(TICKET_SLA_HOURS + 1), NOW)).toBe(true)
        expect(isSlaBreached('pending', hoursAgo(TICKET_SLA_HOURS + 1), NOW)).toBe(true)
    })

    test('the boundary itself is not late — it is strictly older-than', () => {
        expect(isSlaBreached('open', hoursAgo(TICKET_SLA_HOURS), NOW)).toBe(false)
        expect(isSlaBreached('open', hoursAgo(1), NOW)).toBe(false)
    })

    test('resolved is never late, however old', () => {
        expect(isSlaBreached('resolved', hoursAgo(TICKET_SLA_HOURS * 10), NOW)).toBe(false)
    })

    test('an unparseable timestamp is not late — a bad date must not paint the queue red', () => {
        expect(isSlaBreached('open', 'whenever', NOW)).toBe(false)
    })
})
