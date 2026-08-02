import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { WebhookDispatchInput, WebhookDispatchResult } from '../../server-lib/webhook-dispatch'
import { writeJsonAtomicSync } from './atomic-write'
import { dataDir } from './data-dir'

/**
 * The fake webhook counterparty, simulated-mode-only (NOT a port — an app-owned dispatch seam;
 * see the decision log). The Actors precedent, statically: instead of a real HTTP POST to a customer
 * URL, it CATCHES each egress attempt into `.data/webhooks/` — the mail catch-store pattern
 * (packages/keel/src/adapters/fake/email.ts) — so the Simulator Hooks tab can display exactly what would have been
 * sent (the signed body and the signature header). `.data/webhooks/` is a Snapshots LIVE_DIR
 * (simulator-admin.ts), so a reset clears the catch-store and save/restore snapshot it.
 *
 * To let e2e/demo exercise the retry path deterministically, it honours a per-endpoint FAILURE TOGGLE:
 * a Simulator control writes the set of failing endpoint ids to `.data/simulator/webhook-failures.json`
 * (a `simulator` LIVE_DIR file, so reset clears it too), and a dispatch to a toggled endpoint returns a
 * simulated failure instead of "delivering". This is the simplest deterministic mechanism (a plain
 * per-endpoint flag beats magic URL markers — the operator flips it live from the panel).
 */

/** One caught egress attempt, keyed in the store by delivery id (the latest attempt overwrites). */
export interface CaughtWebhook {
    deliveryId: string
    endpointId: string
    url: string
    headers: Record<string, string>
    body: string
    at: string
    ok: boolean
    error?: string
}

function catchFile(deliveryId: string): string {
    return path.join(dataDir('webhooks'), `${deliveryId}.json`)
}

function failuresFile(): string {
    return path.join(dataDir('simulator'), 'webhook-failures.json')
}

/** The set of endpoint ids currently toggled to fail (empty when the file is absent). */
export function readFailingEndpoints(): Set<string> {
    const file = failuresFile()
    if (!existsSync(file)) return new Set()
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as { endpointIds?: unknown }
        return new Set(Array.isArray(parsed.endpointIds) ? parsed.endpointIds.filter((x) => typeof x === 'string') : [])
    } catch {
        return new Set()
    }
}

/** Toggle whether a given endpoint's fake dispatch simulates failure. */
export function setEndpointFailing(endpointId: string, failing: boolean): void {
    const current = readFailingEndpoints()
    if (failing) current.add(endpointId)
    else current.delete(endpointId)
    writeJsonAtomicSync(failuresFile(), { endpointIds: [...current] })
}

/** Read one caught delivery (the latest attempt), or null. */
export function readCaughtWebhook(deliveryId: string): CaughtWebhook | null {
    const file = catchFile(deliveryId)
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as CaughtWebhook) : null
}

/** Every caught delivery across the world — the Simulator Hooks tab merges these onto the DB rows. */
export function listCaughtWebhooks(): CaughtWebhook[] {
    const dir = dataDir('webhooks')
    return readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as CaughtWebhook)
}

/**
 * The fake dispatch: record the attempt to the catch-store (always — even a "failure" is a real egress
 * attempt worth inspecting), then report delivered unless the endpoint is toggled to fail.
 */
export function fakeDispatchWebhook(input: WebhookDispatchInput): WebhookDispatchResult {
    const failing = readFailingEndpoints().has(input.endpointId)
    const result: WebhookDispatchResult = failing
        ? { delivered: false, error: 'fake failure toggle' }
        : { delivered: true, status: 200 }

    const caught: CaughtWebhook = {
        deliveryId: input.deliveryId,
        endpointId: input.endpointId,
        url: input.url,
        headers: input.headers,
        body: input.body,
        at: new Date().toISOString(),
        ok: result.delivered,
        error: result.error,
    }
    writeJsonAtomicSync(catchFile(input.deliveryId), caught)
    return result
}
