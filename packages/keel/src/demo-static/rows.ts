import type { AgreementGating, AgreementKind } from '../core/agreements'
import type { NotificationKind, NotificationPayload } from '../core/notifications'
import type { WebhookEventPayload } from '../core/webhook-events'

/**
 * The in-memory ROW TWINS of the framework's tables, for the `file://` static demo (ADR-0006).
 * There is no server and no database in that host, so every table the framework owns becomes a
 * plain array of these shapes in React state (see ./world.ts). They are deliberately structural
 * mirrors of the real rows rather than the real row types: the real ones are Kysely selectables
 * carrying uuids and timestamps, while the twin's world is addressed by SLUG (there are no ids to
 * resolve against), and pulling the db types in would drag Kysely into a browser bundle.
 *
 * An app's own tables get their own twins in its composition root — only the FRAMEWORK half lives
 * here (ADR-0012).
 */

/**
 * Twin of a jobs row (../db/jobs.ts) joined to its world slugs — carries both what a dashboard job
 * card needs and what the Simulator Jobs/Actors tabs need. `orgSlug` is nullable exactly like the
 * real `org_id` (internal jobs have no team).
 */
export interface DemoJob {
    id: string
    kind: string
    status: string
    tenantSlug: string
    orgSlug: string | null
    createdAt: string
    error: string | null
    timeline: { status: string; at: string; message?: string | null }[]
}

/** Twin of a StoredInvite (../adapters/fake/auth.ts) — with no server an invite is just a row of
 *  state until someone accepts it into a dynamic person. */
export interface DemoInvite {
    id: string
    email: string
    role: string
    orgSlug: string
}

/** Twin of a notifications row. Per-recipient + org scoped: a fan-out delivers one row per admin
 *  recipient, and the header bell filters to the signed-in person. `readAt` flips on bell-open
 *  (mark-all-read). Notifications are just rows, so this is genuine parity. */
export interface DemoNotification {
    id: string
    recipientPersonId: string
    orgSlug: string
    kind: NotificationKind
    payload: NotificationPayload
    readAt: string | null
    createdAt: string
}

/** Twin of a webhook_endpoints row. Org-scoped. The secret is a real random string, and the twin
 *  REALLY signs deliveries with it via the pure core signer (no server needed — genuine parity). */
export interface DemoEndpoint {
    id: string
    tenantSlug: string
    orgSlug: string
    url: string
    secret: string
    eventKinds: string[]
    enabled: boolean
}

/** Twin of a webhook_deliveries row. The retry state machine (pending → failed → delivered | dead)
 *  runs the SAME core policy (backoffDelayMs / MAX_DELIVERY_ATTEMPTS) the server runs; the signature
 *  and body are computed by the pure core signer at delivery time. Times are ms so the world clock
 *  (mountedAtMs + offset) drives due-ness exactly like the schedules twin. */
export interface DemoDelivery {
    id: string
    endpointId: string
    tenantSlug: string
    orgSlug: string
    eventKind: string
    payload: WebhookEventPayload
    status: string
    attemptCount: number
    nextAttemptAtMs: number
    lastError: string | null
    createdAtMs: number
    deliveredAtMs: number | null
    signature: string | null
    body: string | null
}

/** Twin of an agreements row — tenant-scoped world content. */
export interface DemoAgreement {
    id: string
    tenantSlug: string
    kind: AgreementKind
    version: number
    title: string
    bodyMd: string
    gating: AgreementGating
}

/** Twin of the append-only agreement_acceptances table — who accepted which version, when. */
export interface DemoAcceptance {
    agreementId: string
    userId: string
    version: number
    acceptedAt: string
}
