import { defineAbilitiesFor } from 'keel/core/abilities'
import { recordAuditEvent } from 'keel/db/audit'
import type { InboundContext, InboundHandlerResult } from 'keel/inbound-email/handlers'
import { createTicket } from '@/domain/db/tickets'
import type { TicketStatus } from '@/domain/tickets'

/**
 * The desk's front door: email that becomes work. `<org>+support@domain` opens a ticket in the queue;
 * `<org>+feedback@domain` files one that is already resolved. This is the canonical real feature of the
 * domain — a support desk that cannot be emailed is not a support desk — and it is the same framework
 * intake (keel/inbound-email/intake.ts) resolving a handler slug in the registry
 * (src/app-config/inbound-email.ts) for both.
 *
 * SENDER MATCHING + POSTURE. The sender's address is matched against the org's active members via the
 * auth port (listMembers), and the matched member must pass the SAME ability check the tickets route
 * enforces (`can('create', Ticket)`) — email authoring grants no more than the UI, so a `restricted`
 * member whom the ability model denies in the product is refused here too. An unmatched or unauthorized
 * sender does NOT open a ticket: the message is filed 'unmatched' (see the decision log).
 *
 * WHY A DESK STILL REFUSES STRANGERS. It is tempting to read "support desk" as "anyone may write in",
 * and a production desk usually does — but it does so with a spam/abuse posture in front of it. The
 * template ships the CLOSED posture and names the open one: an instance that wants public intake
 * attributes unmatched senders to a system actor instead, which is a one-line change here (return a
 * synthetic actor id rather than 'unmatched') plus whatever rate limiting its abuse model needs.
 *
 * RESIDUAL TRUST. The matched attribution is only as trustworthy as Mailgun's upstream SPF/DKIM
 * alignment on the envelope sender the route hands us: a message that PASSES Mailgun's checks with a
 * forged member address would be attributed to that member. The template accepts this residual (it is
 * the same trust every reply-by-email product carries) and records it here and in the decision log.
 */

/**
 * Both handlers do the same four things — match the sender, check the ability, build the ticket,
 * record the audit event — and differ only in the STATUS the resulting ticket starts in. Factoring
 * that difference into a parameter is what makes the registry's second entry worth having: it shows
 * a second handler is a line of configuration, not a copy of the first.
 */
function ticketFromEmail(status: TicketStatus, auditAction: 'ticket.created') {
    return async (ctx: InboundContext): Promise<InboundHandlerResult> => {
        const members = await ctx.auth.listMembers(ctx.orgSlug)
        const sender = members.find((m) => m.status === 'active' && m.email.toLowerCase() === ctx.fromEmail)
        if (!sender) {
            return { status: 'unmatched', reason: `sender ${ctx.fromEmail} is not a member of ${ctx.orgSlug}` }
        }
        const ability = defineAbilitiesFor({
            userId: sender.id,
            role: sender.role,
            restricted: sender.role === 'restricted',
            activeOrgId: ctx.orgId,
            manageAll: false,
        })
        if (!ability.can('create', { type: 'Ticket', orgId: ctx.orgId })) {
            return { status: 'unmatched', reason: `sender ${ctx.fromEmail} may not open tickets in ${ctx.orgSlug}` }
        }

        // Subject line becomes the ticket subject; the normalized body becomes its body. A one-line
        // "subject only" email still opens a ticket, with the subject standing in for both.
        const subject = ctx.subject.trim()
        const body = ctx.bodyText.trim()
        if (!subject && !body) return { status: 'unmatched', reason: 'empty email (no subject or body)' }

        const ticket = await createTicket(ctx.db, {
            tenantId: ctx.tenantId,
            fallbackSlug: ctx.orgSlug,
            orgId: ctx.orgId,
            subject: subject || body.slice(0, 80),
            body: body || subject,
            status,
        })
        await recordAuditEvent(ctx.db, {
            tenantId: ctx.tenantId,
            orgId: ctx.orgId,
            actorUserId: sender.id,
            action: auditAction,
            subjectType: 'Ticket',
            subjectId: ticket.id,
        })
        return { status: 'handled', actorUserId: sender.id }
    }
}

/** `<org>+support@…` — the queue's front door. The ticket lands OPEN and unassigned. */
export const supportHandler = ticketFromEmail('open', 'ticket.created')

/**
 * `<org>+feedback@…` — the second address, and the reason the registry is a registry. Feedback is worth
 * recording but nobody is waiting on a reply, so the ticket is created already RESOLVED: it never
 * enters the queue, never ages toward the SLA, and never shows up in the digest (which counts only
 * unresolved rows). Same intake, same handler contract, materially different outcome.
 */
export const feedbackHandler = ticketFromEmail('resolved', 'ticket.created')
