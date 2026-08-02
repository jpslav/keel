import {
    type WebhookEnvelope,
    type WebhookEventKind,
    type WebhookEventPayload,
    backoffDelayMs,
    isDeliveryDead,
} from '../core/webhook-events'
import {
    WEBHOOK_DELIVERY_HEADER,
    WEBHOOK_EVENT_HEADER,
    WEBHOOK_SIGNATURE_HEADER,
    webhookSignatureHeader,
} from '../core/webhook-signing'
import type { DbPort } from '../ports/db'
// TYPE-ONLY import (erased): keeps packages/keel/src/db free of a runtime @/adapters dependency — see WebhookDispatch.
import type { WebhookDispatch } from '../server-lib/webhook-dispatch'
import { recordAuditEvent } from './audit'
import { jsonb } from './jsonb'

/** timestamptz comes back from both engines as a Date; local (avoids a jobs.ts import cycle since
 *  jobs.ts imports enqueueWebhookEvent from here). */
function iso(value: unknown): string {
    return value instanceof Date ? value.toISOString() : String(value)
}

// ---------------------------------------------------------------------------
// Emission — cheap: enqueue a delivery row per matching enabled endpoint. NO dispatch here; the drain
// (runDueDeliveries) does the network effect on the next tick. Called from the existing mutation
// choke points (recordJobStatus, the app's own mutation routes) after their own write commits.
// ---------------------------------------------------------------------------

/**
 * Fan an event out to durable delivery rows: one per enabled endpoint in `orgId` subscribed to `kind`.
 * Endpoints are few per org, so the subscription filter is a JS `.includes` over the parsed
 * `event_kinds` array rather than a jsonb-operator predicate (portable across pglite/pg without the
 * `?`/`@>` operator-vs-placeholder ambiguity). `next_attempt_at` is `now`, so the very next drain
 * attempts delivery immediately. Returns how many deliveries were enqueued (0 = no matching endpoint).
 */
export async function enqueueWebhookEvent(
    db: DbPort,
    input: { tenantId: string; orgId: string; kind: WebhookEventKind; payload: WebhookEventPayload },
    now: Date = new Date(),
): Promise<number> {
    return db.withTenant(input.tenantId, async (trx) => {
        const endpoints = await trx
            .selectFrom('webhook_endpoints')
            .select(['id', 'event_kinds'])
            .where('org_id', '=', input.orgId)
            .where('enabled', '=', true)
            .execute()
        const matching = endpoints.filter((e) => (e.event_kinds as string[]).includes(input.kind))
        if (matching.length === 0) return 0
        await trx
            .insertInto('webhook_deliveries')
            .values(
                matching.map((endpoint) => ({
                    tenant_id: input.tenantId,
                    endpoint_id: endpoint.id,
                    event_kind: input.kind,
                    payload: jsonb(input.payload),
                    next_attempt_at: now,
                })),
            )
            .execute()
        return matching.length
    })
}

// ---------------------------------------------------------------------------
// The delivery drain — the outbound twin of runDueSchedules. Same per-tenant
// (tenants × withTenant) shape and per-item fault isolation, because job_schedules/webhook_deliveries
// are both FORCE-RLS and a raw cross-tenant scan only *appears* to work on pglite (build-notes).
// ---------------------------------------------------------------------------

export interface DrainResult {
    delivered: number
    failed: number
    dead: number
}

/**
 * Drains every retryable delivery (`pending`/`failed`) whose next_attempt_at is due at `now`, per
 * tenant, in three phases per delivery so a non-idempotent network POST is never held inside a DB
 * transaction and concurrent ticks can't double-send:
 *
 *   1. CLAIM (txn) — lock the delivery FOR UPDATE, re-check it's still due, bump attempt_count and
 *      PESSIMISTICALLY arm next_attempt_at with the backoff (assume failure). Committing the claim
 *      advances next_attempt_at into the future, so a racing tick sees "not due" and skips.
 *   2. DISPATCH (no txn) — sign the envelope and POST it through the dispatch seam.
 *   3. RECORD (txn) — write the real outcome: delivered, or failed/dead.
 *
 * Delivery is therefore AT-LEAST-ONCE (a crash between claim and record re-sends at the backoff time);
 * the envelope carries the delivery id so consumers dedupe. An audit event is written on first success
 * (webhook.delivered) and on death (webhook.dead) — the durable, append-only webhook record.
 */
export async function runDueDeliveries(db: DbPort, now: Date, dispatch: WebhookDispatch): Promise<DrainResult> {
    await db.ready()
    const tenants = await db.getDb().selectFrom('tenants').select('id').execute()
    const due: { id: string; tenant_id: string }[] = []
    for (const tenant of tenants) {
        const rows = await db.withTenant(tenant.id, (trx) =>
            trx
                .selectFrom('webhook_deliveries')
                .select('id')
                .where('status', 'in', ['pending', 'failed'])
                .where('next_attempt_at', '<=', now)
                .orderBy('next_attempt_at', 'asc')
                .execute(),
        )
        due.push(...rows.map((r) => ({ id: r.id, tenant_id: tenant.id })))
    }

    const result: DrainResult = { delivered: 0, failed: 0, dead: 0 }
    for (const delivery of due) {
        try {
            const outcome = await deliverOne(db, now, delivery, dispatch)
            if (outcome === 'delivered') result.delivered += 1
            else if (outcome === 'failed') result.failed += 1
            else if (outcome === 'dead') result.dead += 1
        } catch {
            // A bad row must not stall the rest — its next_attempt_at may not have advanced, so it's
            // retried on the next tick (the runDueSchedules fault-isolation precedent).
            result.failed += 1
        }
    }
    return result
}

interface Claim {
    attempt: number
    endpointId: string
    orgId: string
    url: string
    secret: string
    kind: WebhookEventKind
    payload: WebhookEventPayload
    createdAt: string
}

async function deliverOne(
    db: DbPort,
    now: Date,
    delivery: { id: string; tenant_id: string },
    dispatch: WebhookDispatch,
): Promise<'delivered' | 'failed' | 'dead' | 'skipped'> {
    // Phase 1: claim under the row lock.
    const claim = await db.withTenant(
        delivery.tenant_id,
        async (trx): Promise<Claim | 'skip' | { disabledOrgId: string }> => {
            const row = await trx
                .selectFrom('webhook_deliveries as d')
                .innerJoin('webhook_endpoints as e', 'e.id', 'd.endpoint_id')
                .select([
                    'd.status as status',
                    'd.event_kind as event_kind',
                    'd.payload as payload',
                    'd.attempt_count as attempt_count',
                    'd.next_attempt_at as next_attempt_at',
                    'd.created_at as created_at',
                    'e.id as endpoint_id',
                    'e.org_id as org_id',
                    'e.url as url',
                    'e.secret as secret',
                    'e.enabled as enabled',
                ])
                .where('d.id', '=', delivery.id)
                .forUpdate()
                .executeTakeFirst()
            // Re-check under the lock: a concurrent tick may have delivered it, killed it, or advanced its
            // next_attempt_at past `now`.
            if (!row || !['pending', 'failed'].includes(row.status) || new Date(row.next_attempt_at) > now)
                return 'skip'

            const attempt = row.attempt_count + 1
            if (!row.enabled) {
                // The endpoint was disabled after enqueue — stop retrying.
                await trx
                    .updateTable('webhook_deliveries')
                    .set({ status: 'dead', attempt_count: attempt, last_error: 'endpoint disabled' })
                    .where('id', '=', delivery.id)
                    .execute()
                return { disabledOrgId: row.org_id }
            }
            // Pessimistic claim: bump the attempt and arm the next retry NOW (assume this attempt fails).
            // Phase 3 overwrites status on success. Even the would-be-final attempt arms a future
            // next_attempt_at so a crash before phase 3 doesn't hot-loop; phase 3 sets 'dead'.
            await trx
                .updateTable('webhook_deliveries')
                .set({
                    status: 'failed',
                    attempt_count: attempt,
                    next_attempt_at: new Date(now.getTime() + backoffDelayMs(attempt)),
                })
                .where('id', '=', delivery.id)
                .execute()
            return {
                attempt,
                endpointId: row.endpoint_id,
                orgId: row.org_id,
                url: row.url,
                secret: row.secret,
                kind: row.event_kind as WebhookEventKind,
                payload: row.payload as WebhookEventPayload,
                createdAt: iso(row.created_at),
            }
        },
    )

    if (claim === 'skip') return 'skipped'
    if ('disabledOrgId' in claim) {
        // Death by disabled endpoint is still a death: same durable audit record as a backoff death,
        // written outside the claim transaction like every other audit (the house precedent).
        await recordAuditEvent(db, {
            tenantId: delivery.tenant_id,
            orgId: claim.disabledOrgId,
            actorUserId: 'system:webhooks',
            action: 'webhook.dead',
            subjectType: 'WebhookDelivery',
            subjectId: delivery.id,
        })
        return 'dead'
    }

    // Phase 2: sign + dispatch OUTSIDE the transaction. Build the body string ONCE so the bytes signed
    // are byte-identical to the bytes sent (and recorded by the fake for the counterparty to verify).
    const timestampSec = Math.floor(now.getTime() / 1000)
    const envelope: WebhookEnvelope = {
        id: delivery.id,
        kind: claim.kind,
        createdAt: claim.createdAt,
        data: claim.payload,
    }
    const body = JSON.stringify(envelope)
    const headers = {
        'content-type': 'application/json',
        [WEBHOOK_SIGNATURE_HEADER]: webhookSignatureHeader(claim.secret, body, timestampSec),
        [WEBHOOK_EVENT_HEADER]: claim.kind,
        [WEBHOOK_DELIVERY_HEADER]: delivery.id,
    }
    const dispatchResult = await dispatch({
        deliveryId: delivery.id,
        endpointId: claim.endpointId,
        url: claim.url,
        headers,
        body,
    })

    // Phase 3: record the real outcome.
    const outcome = await db.withTenant(delivery.tenant_id, async (trx): Promise<'delivered' | 'failed' | 'dead'> => {
        if (dispatchResult.delivered) {
            await trx
                .updateTable('webhook_deliveries')
                .set({ status: 'delivered', last_error: null, delivered_at: now })
                .where('id', '=', delivery.id)
                .execute()
            return 'delivered'
        }
        const dead = isDeliveryDead(claim.attempt)
        await trx
            .updateTable('webhook_deliveries')
            .set({ status: dead ? 'dead' : 'failed', last_error: dispatchResult.error ?? 'delivery failed' })
            .where('id', '=', delivery.id)
            .execute()
        return dead ? 'dead' : 'failed'
    })

    // Audit on first success and on death — the durable record (own transaction, the audit precedent).
    if (outcome === 'delivered') {
        await recordAuditEvent(db, {
            tenantId: delivery.tenant_id,
            orgId: claim.orgId,
            actorUserId: 'system:webhooks',
            action: 'webhook.delivered',
            subjectType: 'WebhookDelivery',
            subjectId: delivery.id,
        })
    } else if (outcome === 'dead') {
        await recordAuditEvent(db, {
            tenantId: delivery.tenant_id,
            orgId: claim.orgId,
            actorUserId: 'system:webhooks',
            action: 'webhook.dead',
            subjectType: 'WebhookDelivery',
            subjectId: delivery.id,
        })
    }
    return outcome
}

// ---------------------------------------------------------------------------
// Org-facing endpoint management (the org-admin card, all authorize()-gated at the route).
// ---------------------------------------------------------------------------

export interface EndpointView {
    id: string
    url: string
    eventKinds: string[]
    enabled: boolean
    createdAt: string
}

/** The active org's endpoints, newest-first. Never returns the secret (shown once on create only). */
export async function listEndpointsForOrg(db: DbPort, tenantId: string, orgId: string): Promise<EndpointView[]> {
    return db.withTenant(tenantId, async (trx) => {
        const rows = await trx
            .selectFrom('webhook_endpoints')
            .select(['id', 'url', 'event_kinds', 'enabled', 'created_at'])
            .where('org_id', '=', orgId)
            .orderBy('created_at', 'desc')
            .execute()
        return rows.map((r) => ({
            id: r.id,
            url: r.url,
            eventKinds: r.event_kinds as string[],
            enabled: r.enabled,
            createdAt: iso(r.created_at),
        }))
    })
}

/** Creates an endpoint for the active org. The secret is generated by the caller (route) and shown once. */
export async function createEndpoint(
    db: DbPort,
    input: {
        tenantId: string
        orgId: string
        url: string
        eventKinds: WebhookEventKind[]
        secret: string
        createdBy: string
    },
): Promise<{ id: string }> {
    return db.withTenant(input.tenantId, (trx) =>
        trx
            .insertInto('webhook_endpoints')
            .values({
                tenant_id: input.tenantId,
                org_id: input.orgId,
                url: input.url,
                secret: input.secret,
                event_kinds: jsonb(input.eventKinds),
                created_by: input.createdBy,
            })
            .returning('id')
            .executeTakeFirstOrThrow(),
    )
}

/**
 * Resolves an endpoint id to its owning org ONLY when it belongs to `orgId` within `tenantId` — null
 * both when absent and when it belongs to another org (a foreign endpoint is indistinguishable from a
 * missing one, so ids can't be probed; the same doctrine as jobForOrg). The route uses
 * this to 404 before authorize().
 */
export async function endpointForOrg(
    db: DbPort,
    tenantId: string,
    orgId: string,
    endpointId: string,
): Promise<{ id: string } | null> {
    return db.withTenant(tenantId, async (trx) => {
        const row = await trx
            .selectFrom('webhook_endpoints')
            .select('id')
            .where('id', '=', endpointId)
            .where('org_id', '=', orgId)
            .executeTakeFirst()
        return row ? { id: row.id } : null
    })
}

/** Enable/disable an endpoint (scoped to the active org by the caller's prior endpointForOrg check). */
export async function setEndpointEnabled(
    db: DbPort,
    tenantId: string,
    endpointId: string,
    enabled: boolean,
): Promise<void> {
    await db.withTenant(tenantId, (trx) =>
        trx.updateTable('webhook_endpoints').set({ enabled }).where('id', '=', endpointId).execute(),
    )
}

/** Delete an endpoint (its deliveries cascade — migration 0010). */
export async function deleteEndpoint(db: DbPort, tenantId: string, endpointId: string): Promise<void> {
    await db.withTenant(tenantId, (trx) => trx.deleteFrom('webhook_endpoints').where('id', '=', endpointId).execute())
}

// ---------------------------------------------------------------------------
// Simulator world views — cross-tenant reads (simulated-mode-only; the route gates them), the
// listSchedulesForWorld precedent: reach past the tenant RLS scope on purpose via the raw handle.
// ---------------------------------------------------------------------------

export interface WorldEndpoint {
    id: string
    url: string
    eventKinds: string[]
    enabled: boolean
    tenantSlug: string
    orgSlug: string
}

export async function listEndpointsForWorld(db: DbPort): Promise<WorldEndpoint[]> {
    await db.ready()
    const rows = await db
        .getDb()
        .selectFrom('webhook_endpoints')
        .innerJoin('tenants', 'tenants.id', 'webhook_endpoints.tenant_id')
        .innerJoin('organizations', 'organizations.id', 'webhook_endpoints.org_id')
        .select([
            'webhook_endpoints.id as id',
            'webhook_endpoints.url as url',
            'webhook_endpoints.event_kinds as event_kinds',
            'webhook_endpoints.enabled as enabled',
            'tenants.slug as tenant_slug',
            'organizations.slug as org_slug',
        ])
        .orderBy('webhook_endpoints.created_at', 'desc')
        .execute()
    return rows.map((r) => ({
        id: r.id,
        url: r.url,
        eventKinds: r.event_kinds as string[],
        enabled: r.enabled,
        tenantSlug: r.tenant_slug,
        orgSlug: r.org_slug,
    }))
}

export interface WorldDelivery {
    id: string
    endpointId: string
    endpointUrl: string
    eventKind: string
    status: string
    attemptCount: number
    nextAttemptAt: string
    lastError: string | null
    createdAt: string
    deliveredAt: string | null
    tenantSlug: string
    orgSlug: string
}

export async function listDeliveriesForWorld(db: DbPort): Promise<WorldDelivery[]> {
    await db.ready()
    const rows = await db
        .getDb()
        .selectFrom('webhook_deliveries as d')
        .innerJoin('webhook_endpoints as e', 'e.id', 'd.endpoint_id')
        .innerJoin('tenants', 'tenants.id', 'd.tenant_id')
        .innerJoin('organizations', 'organizations.id', 'e.org_id')
        .select([
            'd.id as id',
            'd.endpoint_id as endpoint_id',
            'e.url as endpoint_url',
            'd.event_kind as event_kind',
            'd.status as status',
            'd.attempt_count as attempt_count',
            'd.next_attempt_at as next_attempt_at',
            'd.last_error as last_error',
            'd.created_at as created_at',
            'd.delivered_at as delivered_at',
            'tenants.slug as tenant_slug',
            'organizations.slug as org_slug',
        ])
        .orderBy('d.created_at', 'desc')
        .execute()
    return rows.map((r) => ({
        id: r.id,
        endpointId: r.endpoint_id,
        endpointUrl: r.endpoint_url,
        eventKind: r.event_kind,
        status: r.status,
        attemptCount: r.attempt_count,
        nextAttemptAt: iso(r.next_attempt_at),
        lastError: r.last_error,
        createdAt: iso(r.created_at),
        deliveredAt: r.delivered_at ? iso(r.delivered_at) : null,
        tenantSlug: r.tenant_slug,
        orgSlug: r.org_slug,
    }))
}
