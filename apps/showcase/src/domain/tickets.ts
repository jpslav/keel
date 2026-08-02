import { defineStateMachine } from 'keel/core/state-machine'

/**
 * The ticket — the desk's unit of work. PURE TypeScript, no framework imports beyond core (ADR-0006,
 * lint-enforced): the status vocabulary, the lifecycle guard, the reference-number rule and the SLA
 * arithmetic are shared VERBATIM by the server routes, the inbound-email handlers and the static-demo
 * twin, so "what a ticket is" can never drift between them.
 */

export const TICKET_STATUSES = ['open', 'pending', 'resolved'] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]

/**
 * A ticket's lifecycle. Unlike the escalation machine, this one is NOT one-way: a resolved ticket that
 * the customer replies to is reopened, and a ticket waiting on someone else goes back to open when the
 * answer lands. What the machine still forbids is a no-op transition (open → open), so a PATCH that
 * changes nothing is a 409 rather than a silent audit event about a write that did not happen.
 */
export const ticketMachine = defineStateMachine<TicketStatus>({
    open: ['pending', 'resolved'],
    pending: ['open', 'resolved'],
    resolved: ['open'],
})

export function isTicketStatus(value: string): value is TicketStatus {
    return (TICKET_STATUSES as readonly string[]).includes(value)
}

/**
 * How long a ticket may sit before the desk considers it late. Deliberately a plain constant, not a
 * per-tenant policy table: the template's job is to show a product rule reaching the UI (the
 * `sla-breach-banner` Simulator flag renders against it), not to build an SLA engine.
 */
export const TICKET_SLA_HOURS = 48

/**
 * How many tickets the queue shows at once, and how many each "load more" adds. An APP decision, not
 * a framework one: the framework caps a page (`KEYSET_MAX_LIMIT`) but has no opinion on what reads
 * well on a support desk. Deliberately small so the seeded demo actually paginates in front of you —
 * a page size no seeded world ever reaches would be a pagination feature nobody can see working.
 */
export const TICKET_PAGE_SIZE = 5

/** True when an unresolved ticket has been open longer than the desk's SLA. Resolved is never late. */
export function isSlaBreached(status: string, createdAtIso: string, nowMs: number): boolean {
    if (status === 'resolved') return false
    const created = Date.parse(createdAtIso)
    if (Number.isNaN(created)) return false
    return nowMs - created > TICKET_SLA_HOURS * 3_600_000
}

/** Split `NW-1041` into its parts; null for anything that is not a desk reference. */
function parseRef(ref: string): { prefix: string; n: number } | null {
    const match = /^([A-Z]{2,6})-(\d{1,9})$/.exec(ref)
    return match ? { prefix: match[1]!, n: Number(match[2]) } : null
}

/**
 * The next reference for a tenant's queue: one past the highest number already issued, keeping whatever
 * prefix that tenant's queue already uses. A tenant with no tickets yet starts its own series from
 * `fallbackSlug`'s first two letters — so a brand-new site gets a sane number without any
 * configuration, and an existing site keeps the series its people already quote at each other.
 *
 * Not a database sequence on purpose: the number is per-TENANT, and a shared sequence would leak one
 * tenant's volume to another (`NW-4` next to `NW-9812` tells you who else is busy). The caller issues
 * this inside the same transaction as the INSERT, and the table's (tenant_id, ref) unique index is the
 * backstop if two agents ever race (createTicket retries the loser — see ./db/tickets.ts).
 *
 * MIXED PREFIXES, precisely: "whatever prefix that tenant's queue already uses" assumes ONE prefix,
 * which is what a queue seeded from a single slug has. If a queue somehow holds two, the highest
 * NUMBER wins and its prefix comes with it — so `['AB-9999', 'NW-1041']` yields `AB-10000`, not
 * `NW-1042`. That is deliberate (the number must never go backwards, and a per-prefix series would
 * make `ref` non-unique per tenant), but it means a tenant cannot be migrated to a new prefix by
 * renaming a few rows. Unparseable refs are ignored entirely rather than resetting the series.
 */
export function nextTicketRef(existingRefs: readonly string[], fallbackSlug: string): string {
    const parsed = existingRefs.map(parseRef).filter((r): r is { prefix: string; n: number } => r !== null)
    if (parsed.length === 0) {
        return `${
            fallbackSlug
                .replace(/[^a-z]/gi, '')
                .slice(0, 2)
                .toUpperCase() || 'T'
        }-1`
    }
    const highest = parsed.reduce((best, r) => (r.n > best.n ? r : best))
    return `${highest.prefix}-${highest.n + 1}`
}
