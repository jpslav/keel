import { isSimulated } from '../adapters/index'

/**
 * The outbound-webhook DISPATCH seam — app-owned server machinery, NOT a vendor port (there
 * is no vendor SDK; `fetch` is a global). It's the same shape as packages/keel/src/service-auth: a thin interface
 * with a real implementation here and a fake selected behind `isSimulated` (the service-auth/webhook
 * `expectedSecret()` precedent for pulling a fake-only helper into shared glue). Real dispatch is a
 * plain signed POST with a timeout; the fake records the attempt into `.data/webhooks/` and honours a
 * per-endpoint failure toggle so retries can be exercised deterministically. See the decision log for
 * why this lives in server-lib (real fetch) + adapters/fake (recorder) rather than a port.
 *
 * The drain (packages/keel/src/db/webhooks.ts) does the DB state machine; this seam is ONLY the network effect, so it
 * is called AFTER the claim commits and BEFORE the outcome is recorded — never inside a DB transaction.
 */
export interface WebhookDispatchInput {
    /** The delivery id — the fake uses it as its catch-store key; the real POST ignores it. */
    deliveryId: string
    /** The endpoint id — the fake reads the failure toggle by it; the real POST ignores it. */
    endpointId: string
    url: string
    headers: Record<string, string>
    body: string
}

export interface WebhookDispatchResult {
    delivered: boolean
    /** HTTP status when there was a response (real) or a simulated one (fake). */
    status?: number
    /** Short failure reason recorded as the delivery's last_error. */
    error?: string
}

/**
 * The dispatcher signature the drain (packages/keel/src/db/webhooks.ts) depends on. The drain takes it as a PARAMETER
 * (the runDueSchedules-injects-JobsPort precedent) rather than importing dispatchWebhook, so packages/keel/src/db
 * never imports @/adapters — which would pull `server-only` into its happy-dom unit tests. The routes,
 * which already use @/adapters, pass `dispatchWebhook`; tests pass the fake directly.
 */
export type WebhookDispatch = (input: WebhookDispatchInput) => WebhookDispatchResult | Promise<WebhookDispatchResult>

/** How long a real POST may take before it's abandoned as a failed attempt (retried per the backoff). */
const WEBHOOK_TIMEOUT_MS = 10_000

/*
 * SSRF POSTURE (recorded decision — see docs/decision-log.md). The server POSTs to a URL an
 * org ADMIN registered: scheme-checked (http/https) at the route, but not IP-filtered — so an admin
 * can point it at private/link-local space (cloud metadata, VPC-internal hosts). The template accepts
 * this with eyes open: registering endpoints is admin-gated, the body is app-composed (never
 * attacker-chosen bytes), and the default deployment (ADR-0001 Lambda, no VPC) has no internal
 * network to reach. An instance that deploys INTO a private network must add egress controls at
 * cutover (VPC egress proxy / allowlist, or an IP guard here) — this comment is the seam marker.
 */
export async function dispatchWebhook(input: WebhookDispatchInput): Promise<WebhookDispatchResult> {
    if (isSimulated) {
        // Pulled in behind isSimulated so the fake's node fs code is never reached in a real build
        // (the /api/simulator first-line-404 containment shape).
        const { fakeDispatchWebhook } = await import('../adapters/fake/webhooks')
        return fakeDispatchWebhook(input)
    }

    try {
        const response = await fetch(input.url, {
            method: 'POST',
            headers: input.headers,
            body: input.body,
            signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        })
        return response.ok
            ? { delivered: true, status: response.status }
            : { delivered: false, status: response.status, error: `HTTP ${response.status}` }
    } catch (error) {
        // Timeout, DNS failure, connection refused — all "failed attempt, retry per backoff".
        return { delivered: false, error: error instanceof Error ? error.message : 'dispatch failed' }
    }
}
