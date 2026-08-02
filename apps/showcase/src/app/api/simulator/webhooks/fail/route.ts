import { isSimulated } from 'keel/adapters/index'
import { setEndpointFailing } from 'keel/adapters/fake/webhooks'
import { withPortErrors } from '../../../respond'

/**
 * Simulator failure-toggle control (simulated-mode-only; 404 in real): mark an endpoint's fake dispatch to
 * fail (or recover). This is how a demo/e2e drives the retry path deterministically. Exempt from the
 * authorize() scan by the simulator/ simulated-mode gate — it's a simulated-world knob, not a product mutation.
 */
export async function POST(request: Request): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        const body = (await request.json().catch(() => null)) as { endpointId?: unknown; failing?: unknown } | null
        if (!body || typeof body.endpointId !== 'string' || typeof body.failing !== 'boolean') {
            return Response.json({ error: 'invalid-request' }, { status: 400 })
        }
        setEndpointFailing(body.endpointId, body.failing)
        return Response.json({ ok: true, failing: body.failing })
    })
}
