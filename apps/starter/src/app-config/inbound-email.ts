import type { InboundHandler } from 'keel/inbound-email/handlers'

/**
 * The app's inbound-email handler registrations (ADR-0012 seam). The recipient address
 * `<org-slug>+<slug>@domain` names the slug; the framework intake looks it up in the composed registry.
 *
 * EMPTY REGISTRATION: this app accepts no email. Every inbound message therefore files as 'unmatched',
 * which is the framework's own fail-closed behaviour for an unknown slug — no removal surgery needed.
 */
export const appInboundHandlers: Record<string, InboundHandler> = {}
