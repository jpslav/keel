import type { AuthPort } from '../ports/auth'
import type { DbPort } from '../ports/db'
import { appInboundHandlers } from '@app-config/inbound-email'

/**
 * The inbound-email handler registry — shaped like the job handler map in
 * src/app-config/jobs.ts, but keyed by an OPEN
 * string handler slug rather than an exhaustive union: adding email handlers is instance work (the
 * "more email handlers" member of an already-demonstrated class), so the registry is a plain
 * Record<string, InboundHandler>. The recipient address `<org-slug>+<handler>@domain` names the slug;
 * intake looks it up here. A slug with no entry files the message 'unmatched' (handler NULL).
 */

/** What a running handler is given: the ports it may touch plus the resolved tenant/org + the message. */
export interface InboundContext {
    db: DbPort
    auth: AuthPort
    tenantId: string
    orgId: string
    orgSlug: string
    /** Normalized sender addr-spec (lowercased, display name stripped). */
    fromEmail: string
    subject: string
    /** Normalized plain-text body (quoted reply chain stripped — packages/keel/src/core/inbound-email.ts). */
    bodyText: string
    /** The inbound_emails row id this handler is processing. */
    emailId: string
}

/**
 * A handler either PRODUCED its effect ('handled', naming the actor to attribute the audit event to) or
 * DECLINED ('unmatched', with a reason — e.g. the sender is not a team member). A THROW is a third,
 * separate outcome intake catches → 'failed' (the row is kept, the webhook still 200s). Handlers own
 * their own domain audit event, with the same verb the equivalent product route would record; intake
 * records the `inbound-email.received` intake event on top.
 *
 * `subjectId` is optional: the id of the row the handler created (the ticket an email opened), when it
 * created one. Intake passes it through on its outcome, which is how a demo preset's `inbound` step can
 * name what the email produced (`as`, keel/core/presets.ts) for a later step to act on.
 */
export type InboundHandlerResult =
    { status: 'handled'; actorUserId: string; subjectId?: string } | { status: 'unmatched'; reason: string }

export type InboundHandler = (ctx: InboundContext) => Promise<InboundHandlerResult>

/** One handler per slug, composed like jobHandlers: framework handlers (none today) spread beside the
 *  app's registrations from the ADR-0012 seam. The slug is the `+tag` in `<org>+<slug>@domain`. */
export const inboundHandlers: Record<string, InboundHandler> = {
    ...appInboundHandlers,
}
