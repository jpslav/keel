import { isSimulated } from 'keel/adapters/index'
import { KNOWN_FLAGS, listCapturedEvents, readFlags } from 'keel/adapters/fake/analytics'
import { withPortErrors } from '../../respond'

/**
 * Simulator-mode gate, not a role gate (design invariant): 404s outside simulated mode, first line, no
 * role check. Feeds the Events tab's log + feature-flag list — no RSC page reads these anymore.
 */
export async function GET(): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        const events = listCapturedEvents()
        const storedFlags = readFlags()
        const flags = KNOWN_FLAGS.map((flag) => ({ flag, enabled: storedFlags[flag] ?? false }))
        return Response.json({ events, flags })
    })
}
