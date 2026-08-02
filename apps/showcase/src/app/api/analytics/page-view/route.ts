import { analytics, auth } from 'keel/adapters/index'
import { withPortErrors } from '../../respond'

export async function POST(request: Request): Promise<Response> {
    return withPortErrors(async () => {
        const user = await auth.getCurrentUser()
        // A page-view beacon must never 500: an aborted/empty body just yields an empty path.
        const body = (await request.json().catch(() => ({}))) as { path?: unknown }
        const path = String(body.path ?? '').slice(0, 512)
        // The fake analytics adapter piggybacks page_view captures into Simulator continuity
        // (lastPath), so this route speaks only through the port — no mode branch here.
        if (user) await analytics.capture('page_view', { tenant: user.tenantSlug, path }, user.id)
        return new Response(null, { status: 204 })
    })
}
