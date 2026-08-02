/**
 * The APP's outbound-webhook event kinds (the seam side of keel/core/webhook-events.ts, ADR-0012). The
 * framework owns the backoff policy, the signed envelope, and its own kind (job.status_changed); the
 * app registers its OWN kinds + payload shapes here. PURE TypeScript.
 *
 * ONE kind, because `db/webhooks.test.ts` subscribes an endpoint to an APP kind to prove the registry
 * composes — with an empty registration that assertion would not even typecheck.
 */
export const appWebhookEventKinds = ['docket.filed'] as const
export type AppWebhookEventKind = (typeof appWebhookEventKinds)[number]

/** Per-kind payload shapes (also the `data` of the signed delivery envelope) for the app kinds. */
export interface AppWebhookEventPayloadMap {
    'docket.filed': { docketId: string; label: string; orgId: string }
}
