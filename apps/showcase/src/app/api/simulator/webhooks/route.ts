import { db, isSimulated } from 'keel/adapters/index'
import { listCaughtWebhooks, readFailingEndpoints } from 'keel/adapters/fake/webhooks'
import { WEBHOOK_SIGNATURE_HEADER } from 'keel/core/webhook-signing'
import { listDeliveriesForWorld, listEndpointsForWorld } from 'keel/db/webhooks'
import { withPortErrors } from '../../respond'

/**
 * The Simulator Hooks tab's cross-tenant read (simulated-mode-only; 404 in real). Returns every endpoint and
 * delivery across tenants (the listSchedulesForWorld precedent, reaching past tenant RLS on purpose),
 * plus per-delivery the SIGNED body + signature header caught by the fake dispatch (so the panel can
 * display exactly what would have gone over the wire), plus which endpoints are toggled to fail.
 */
export async function GET(): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        const endpoints = await listEndpointsForWorld(db)
        const deliveries = await listDeliveriesForWorld(db)
        const caught = new Map(listCaughtWebhooks().map((c) => [c.deliveryId, c]))
        const merged = deliveries.map((d) => {
            const c = caught.get(d.id)
            return { ...d, signature: c?.headers[WEBHOOK_SIGNATURE_HEADER] ?? null, body: c?.body ?? null }
        })
        return Response.json({ endpoints, deliveries: merged, failingEndpointIds: [...readFailingEndpoints()] })
    })
}
