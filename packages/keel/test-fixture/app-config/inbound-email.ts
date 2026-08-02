import type { InboundHandler } from 'keel/inbound-email/handlers'
import { supportHandler } from '../domain/inbound-handlers'

/**
 * The app's inbound-email handler registrations (ADR-0012 seam). The recipient address
 * `<org-slug>+<slug>@domain` names the slug; the framework intake looks it up in the composed registry,
 * and a slug with no entry files the message 'unmatched'.
 *
 * ONE handler, under `support`. `inbound-email/intake.test.ts` addresses that exact slug for its
 * handled/declined/restricted cases and an invented one for the unknown-slug case, so both halves of
 * the registry's behaviour are covered by a single registration.
 */
export const appInboundHandlers: Record<string, InboundHandler> = {
    support: supportHandler,
}
