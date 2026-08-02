/**
 * The APP's outbound-webhook event kinds (the seam side of keel/core/webhook-events.ts, ADR-0012). The
 * framework owns the backoff policy, the signed envelope, and its own kind (job.status_changed).
 *
 * EMPTY REGISTRATION: no app events. Endpoints can still be registered and still receive the
 * framework's own event; the subscribe list simply offers one kind instead of three.
 */
export const appWebhookEventKinds = [] as const
export type AppWebhookEventKind = (typeof appWebhookEventKinds)[number]

/** Per-kind payload shapes for the app kinds. There are none, so this contributes nothing to the
 *  intersection the framework builds (`Framework & App`). */
export type AppWebhookEventPayloadMap = Record<never, never>
