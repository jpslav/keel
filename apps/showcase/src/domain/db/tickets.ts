import { sql } from 'kysely'
import type { KeysetPosition } from 'keel/core/keyset'
import { toIso } from 'keel/db/jobs'
import { keysetPage } from 'keel/db/keyset'
import type { DbPort } from 'keel/ports/db'
import { TICKET_PAGE_SIZE, nextTicketRef, type TicketStatus, ticketMachine } from '@/domain/tickets'

/** A ticket as its owning team sees it in the queue. */
export interface TicketView {
    id: string
    ref: string
    subject: string
    body: string
    status: TicketStatus
    /** Opaque user id of the agent working it, or null while it sits unclaimed. */
    assigneeUserId: string | null
    createdAt: string
    updatedAt: string
}

function toView(row: {
    id: string
    ref: string
    subject: string
    body: string
    status: string
    assignee_user_id: string | null
    created_at: string
    updated_at: string
}): TicketView {
    return {
        id: row.id,
        ref: row.ref,
        subject: row.subject,
        body: row.body,
        status: row.status as TicketStatus,
        assigneeUserId: row.assignee_user_id,
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at),
    }
}

const COLUMNS = ['id', 'ref', 'subject', 'body', 'status', 'assignee_user_id', 'created_at', 'updated_at'] as const

/** One page of a team's queue, plus the token that fetches the next one (null at the end). */
export interface TicketPage {
    tickets: TicketView[]
    nextCursor: string | null
}

/**
 * Lists ONE PAGE of a team's queue, newest-first — tenant-scoped by RLS AND org-filtered, the same two
 * boundaries as every other list in the app (ADR-0004).
 *
 * The queue is the app's most obviously unbounded list — a desk that has been open a year has a year
 * of tickets — so it is the one that pages, through the framework primitive (`keel/db/keyset`) rather
 * than a hand-rolled LIMIT/OFFSET. Note what this function does NOT do: it never re-applies the tenant
 * or the org itself on a later page, because there is no "later page" code path. The callback below is
 * THE query, run once per page, with the cursor added as one more conjunct — so page 7 is scoped by
 * construction, not by remembering.
 */
export async function listTickets(
    db: DbPort,
    tenantId: string,
    orgId: string,
    page?: { after?: KeysetPosition | null; limit?: number },
): Promise<TicketPage> {
    const result = await keysetPage(
        db,
        { tenantId, after: page?.after ?? null, limit: page?.limit ?? TICKET_PAGE_SIZE },
        (trx) => trx.selectFrom('tickets').select(COLUMNS).where('org_id', '=', orgId),
    )
    return { tickets: result.rows.map(toView), nextCursor: result.nextCursor }
}

/** How many times a create may lose the reference race before the caller sees the failure. */
const REF_RACE_RETRIES = 3

/**
 * True for the ONE failure this create is allowed to retry: another transaction took the reference
 * we had just picked. `23505` is Postgres's unique_violation SQLSTATE, surfaced on `code` by both
 * node-postgres and pglite; the index name is checked too, so a unique violation from anywhere else
 * is never quietly swallowed and retried.
 */
function isRefCollision(error: unknown): boolean {
    const { code, constraint } = (error ?? {}) as { code?: string; constraint?: string }
    return code === '23505' && (constraint === undefined || constraint === 'tickets_tenant_ref_idx')
}

/**
 * Opens a ticket: ONE tenant-scoped transaction that allocates the next reference for this tenant's
 * queue and inserts the row. Reference allocation and INSERT share the transaction on purpose — the
 * (tenant_id, ref) unique index means the loser of a race gets a failed insert rather than a second
 * ticket called NW-1042. RLS pins tenant_id, so a ticket can never be planted into another tenant.
 *
 * The loser then RETRIES, up to REF_RACE_RETRIES times, because the index alone only turns a
 * double-number into an error — someone still has to pick the next free one, and making the person
 * who pressed "Open ticket" second eat a 500 is not a lifecycle conflict worth reporting (nothing
 * about their request was wrong). Each retry is a fresh transaction, so it re-reads the queue and
 * picks the number the winner did not take. Only a reference collision is retried; every other
 * failure propagates on the first attempt.
 */
export async function createTicket(
    db: DbPort,
    input: {
        tenantId: string
        /** Only used to seed a brand-new tenant's reference series — see nextTicketRef. */
        fallbackSlug: string
        orgId: string
        subject: string
        body: string
        status?: TicketStatus
        assigneeUserId?: string | null
    },
): Promise<TicketView> {
    for (let attempt = 0; ; attempt += 1) {
        try {
            return await db.withTenant(input.tenantId, async (trx) => {
                const existing = await trx.selectFrom('tickets').select('ref').execute()
                const ref = nextTicketRef(
                    existing.map((r) => r.ref),
                    input.fallbackSlug,
                )
                const row = await trx
                    .insertInto('tickets')
                    .values({
                        tenant_id: input.tenantId,
                        org_id: input.orgId,
                        ref,
                        subject: input.subject,
                        body: input.body,
                        status: input.status ?? 'open',
                        assignee_user_id: input.assigneeUserId ?? null,
                    })
                    .returning(COLUMNS)
                    .executeTakeFirstOrThrow()
                return toView(row)
            })
        } catch (error) {
            if (attempt >= REF_RACE_RETRIES || !isRefCollision(error)) throw error
        }
    }
}

/**
 * Resolves a ticket id to its row ONLY when it belongs to `orgId` within `tenantId` — returns null both
 * when the ticket is absent AND when it belongs to another team, so a foreign ticket is
 * indistinguishable from a missing one and ids cannot be probed (the jobForOrg doctrine).
 */
export async function ticketForOrg(
    db: DbPort,
    tenantId: string,
    orgId: string,
    ticketId: string,
): Promise<TicketView | null> {
    return db.withTenant(tenantId, async (trx) => {
        const row = await trx
            .selectFrom('tickets')
            .select(COLUMNS)
            .where('id', '=', ticketId)
            .where('org_id', '=', orgId)
            .executeTakeFirst()
        return row ? toView(row) : null
    })
}

/**
 * THE choke point for every ticket edit. One tenant-scoped transaction locks the row (FOR UPDATE, so
 * two agents editing the same ticket serialize instead of double-writing), asserts any status hop is
 * legal — an illegal one throws InvalidTransitionError and rolls back, which the route turns into a
 * 409 — then writes the change and bumps updated_at. Passing neither field is refused upstream.
 *
 * `assigneeUserId` is a THREE-state input: absent = leave alone, null = unassign, a string = assign.
 */
export async function updateTicket(
    db: DbPort,
    tenantId: string,
    orgId: string,
    ticketId: string,
    changes: { status?: TicketStatus; assigneeUserId?: string | null },
): Promise<TicketView | null> {
    return db.withTenant(tenantId, async (trx) => {
        const current = await trx
            .selectFrom('tickets')
            .select(['id', 'status'])
            .where('id', '=', ticketId)
            .where('org_id', '=', orgId)
            .forUpdate()
            .executeTakeFirst()
        if (!current) return null
        if (changes.status !== undefined) {
            ticketMachine.assertTransition(current.status as TicketStatus, changes.status)
        }
        const row = await trx
            .updateTable('tickets')
            .set({
                ...(changes.status !== undefined ? { status: changes.status } : {}),
                ...(changes.assigneeUserId !== undefined ? { assignee_user_id: changes.assigneeUserId } : {}),
                updated_at: sql`now()`,
            })
            .where('id', '=', ticketId)
            .where('org_id', '=', orgId)
            .returning(COLUMNS)
            .executeTakeFirstOrThrow()
        return toView(row)
    })
}

/**
 * Deletes a ticket, org-scoped so one team can never delete another's. A real DELETE, not a soft one —
 * this is the reachable end of the `Ticket: delete` ability rule, and the tickets table is the one app
 * table that carries the DELETE grant (an escalation is an auditable decision and may only be
 * soft-cancelled). The `ticket.deleted` audit event outlives the row, which is the point of the audit
 * log being a separate table.
 *
 * Returns the number of rows removed: 0 means "not this team's ticket, or already gone", which the
 * route turns into a 404 without distinguishing the two.
 */
export async function deleteTicket(db: DbPort, tenantId: string, orgId: string, ticketId: string): Promise<number> {
    const result = await db.withTenant(tenantId, (trx) =>
        trx.deleteFrom('tickets').where('id', '=', ticketId).where('org_id', '=', orgId).execute(),
    )
    return Number(result[0]?.numDeletedRows ?? 0)
}
