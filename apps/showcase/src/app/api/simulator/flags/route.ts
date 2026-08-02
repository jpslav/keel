import { isSimulated } from 'keel/adapters/index'
import { KNOWN_FLAGS, setFlag } from 'keel/adapters/fake/analytics'
import { withPortErrors } from '../../respond'

/**
 * Toggles a feature flag persisted at .data/analytics/flags.json — one of the Snapshots tab's world
 * knobs. Same simulated-mode-only gate as the rest of /api/simulator/*; no auth required (mode, not
 * role — and not even a session: the knobs stay reachable signed-out, like reset). Formerly
 * /api/dev/flags; see docs/decision-log.md.
 */
export async function POST(request: Request): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        const body = (await request.json()) as { flag?: unknown; enabled?: unknown }
        if (typeof body.flag !== 'string' || !KNOWN_FLAGS.includes(body.flag) || typeof body.enabled !== 'boolean') {
            return Response.json({ error: 'invalid flag' }, { status: 400 })
        }
        setFlag(body.flag, body.enabled)
        return Response.json({ ok: true })
    })
}
