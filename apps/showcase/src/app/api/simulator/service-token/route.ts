import { isSimulated } from 'keel/adapters/index'
import { mintServiceToken } from 'keel/adapters/fake/service-auth'
import { withPortErrors } from '../../respond'

/**
 * Simulator-mode gate, not a role gate (design invariant): 404s outside simulated mode, first line. Mints
 * a short-lived M2M token for an org so the operator can drive the manual service-caller flow (the
 * simulated-world analog of an org provisioning its own service credentials). An unknown org slug
 * becomes a 404 (NotFoundError → withPortErrors).
 */
export async function POST(request: Request): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        const { orgSlug, tenantSlug } = (await request.json()) as { orgSlug?: unknown; tenantSlug?: unknown }
        if (typeof orgSlug !== 'string' || (tenantSlug !== undefined && typeof tenantSlug !== 'string')) {
            return Response.json({ error: 'invalid-payload' }, { status: 400 })
        }
        return Response.json(await mintServiceToken(orgSlug, tenantSlug))
    })
}
