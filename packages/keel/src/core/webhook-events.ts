import { appWebhookEventKinds, type AppWebhookEventKind, type AppWebhookEventPayloadMap } from '@app-config/webhooks'

/**
 * The outbound-webhook event registry — PURE TypeScript (ADR-0006/-0012, lint-enforced): no
 * framework, no node builtins, so it is shared verbatim by the server (packages/keel/src/db/webhooks.ts) and the
 * static-demo twin. It names the events an instance can subscribe an endpoint to, types each event's
 * payload, and owns the retry backoff policy.
 *
 * FRAMEWORK/APP LINE (ADR-0012): the framework owns the backoff policy, the signed envelope, and its
 * OWN event kind (job.status_changed, emitted from recordJobStatus); app kinds (emitted from the app's
 * own mutation routes) register through the seam (appWebhookEventKinds), composed below. An adopter
 * adds events by editing src/app-config/webhooks.ts.
 */
export const FRAMEWORK_WEBHOOK_EVENT_KINDS = ['job.status_changed'] as const
type FrameworkWebhookEventKind = (typeof FRAMEWORK_WEBHOOK_EVENT_KINDS)[number]

/** The full event-kind union: framework base + the app's registered kinds. */
export type WebhookEventKind = FrameworkWebhookEventKind | AppWebhookEventKind

/** The composed registry (framework kinds + app kinds), name-order preserved. */
export const WEBHOOK_EVENT_KINDS: readonly WebhookEventKind[] = [
    ...FRAMEWORK_WEBHOOK_EVENT_KINDS,
    ...appWebhookEventKinds,
]

/** True iff `value` is one of the registered event kinds (validates an endpoint's subscribe list). */
export function isWebhookEventKind(value: unknown): value is WebhookEventKind {
    return typeof value === 'string' && (WEBHOOK_EVENT_KINDS as readonly string[]).includes(value)
}

/** The payload shape carried by each framework event kind (also the `data` of the signed envelope). */
interface FrameworkWebhookEventPayloadMap {
    'job.status_changed': { jobId: string; jobKind: string; status: string; orgId: string }
}

/** The composed payload map (framework + app), so WebhookEventPayload covers every registered kind. */
type WebhookEventPayloadMap = FrameworkWebhookEventPayloadMap & AppWebhookEventPayloadMap

export type WebhookEventPayload = WebhookEventPayloadMap[WebhookEventKind]

/** The JSON envelope that is signed and POSTed to an endpoint. `id` is the delivery id — consumers
 *  MUST dedupe on it, because delivery is at-least-once (a claim-then-dispatch crash re-sends). */
export interface WebhookEnvelope {
    id: string
    kind: WebhookEventKind
    createdAt: string
    data: WebhookEventPayload
}

/**
 * Retry backoff policy. A delivery is attempted at enqueue time, then re-attempted after each of these
 * delays if it keeps failing; after MAX_DELIVERY_ATTEMPTS failed attempts it is marked 'dead' and never
 * retried again. The schedule is deliberately coarse and capped (1m → 5m → 30m → 2h → 6h) — enough
 * spread to ride out a counterparty's short outage without hammering it, short enough that a demo can
 * cross a step by advancing the world clock one hour. `attempt` is 1-based: the delay returned by
 * backoffDelayMs(n) is the wait BEFORE attempt n+1 (i.e. armed right after attempt n fails).
 */
export const BACKOFF_SCHEDULE_MS = [
    60_000, // after attempt 1 → wait 1m
    5 * 60_000, // after attempt 2 → wait 5m
    30 * 60_000, // after attempt 3 → wait 30m
    2 * 60 * 60_000, // after attempt 4 → wait 2h
    6 * 60 * 60_000, // after attempt 5 → wait 6h (only relevant if MAX rises above 5)
] as const

/** Max delivery attempts before a delivery is declared 'dead'. Five gives ~2h40m of retry spread. */
export const MAX_DELIVERY_ATTEMPTS = 5

/**
 * The backoff delay (ms) to wait before the next attempt, given how many attempts have now failed.
 * Clamped to the last schedule entry so a config change to MAX_DELIVERY_ATTEMPTS can't index past it.
 * `attempt` < 1 is treated as 1 (defensive).
 */
export function backoffDelayMs(attempt: number): number {
    const index = Math.min(Math.max(Math.floor(attempt), 1), BACKOFF_SCHEDULE_MS.length) - 1
    return BACKOFF_SCHEDULE_MS[index]!
}

/** True once `attemptCount` failed attempts have exhausted the retry budget (→ mark the delivery dead). */
export function isDeliveryDead(attemptCount: number): boolean {
    return attemptCount >= MAX_DELIVERY_ATTEMPTS
}
