/**
 * The APP's outbound-webhook event kinds (the seam side of packages/keel/src/core/webhook-events.ts, ADR-0012). The
 * framework owns the backoff policy + envelope + its own kind (job.status_changed); the app registers
 * its OWN kinds + payload shapes here. A real adopter replaces this file. PURE TypeScript.
 *
 * The escalation.* pair is emitted from the escalation routes' mutation choke points — a partner whose
 * queue depends on the desk's decisions subscribes to `escalation.decided` and hears the outcome the
 * moment the receiving team clicks Accept.
 */
export const appWebhookEventKinds = ['escalation.created', 'escalation.decided'] as const
export type AppWebhookEventKind = (typeof appWebhookEventKinds)[number]

/** Per-kind payload shapes (also the `data` of the signed delivery envelope) for the app kinds. */
export interface AppWebhookEventPayloadMap {
    'escalation.created': { escalationId: string; subject: string; requesterOrgId: string; responderOrgId: string }
    'escalation.decided': {
        escalationId: string
        decision: 'accepted' | 'rejected' | 'cancelled'
        requesterOrgId: string
        responderOrgId: string
    }
}
