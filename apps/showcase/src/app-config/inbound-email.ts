import type { InboundHandler } from 'keel/inbound-email/handlers'
import { feedbackHandler, supportHandler } from '@/domain/inbound-handlers'

/**
 * The app's inbound-email handler registrations (ADR-0012 seam) — the inbound twin of appJobHandlers.
 * The recipient address `<org-slug>+<slug>@domain` names the slug; the framework intake
 * (packages/keel/src/inbound-email/intake.ts) looks it up in the composed registry. A slug with no entry files the
 * message 'unmatched'.
 *
 * TWO handlers, because email-into-the-product is THE canonical feature of a support desk and one
 * handler never shows that the registry routes:
 * - `support`  → `frontline+support@…`  opens a TICKET. This is the desk's real front door.
 * - `feedback` → `frontline+feedback@…` files a low-priority ticket that starts life already
 *   `resolved`, so it lands in the record without ever entering the queue. Same registry, same
 *   intake, materially different outcome — which is the point.
 */
export const appInboundHandlers: Record<string, InboundHandler> = {
    support: supportHandler,
    feedback: feedbackHandler,
}
