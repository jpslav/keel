import { isSimulated } from 'keel/adapters/index'
import { resetWorld } from 'keel/adapters/fake/simulator-admin'
import { withPortErrors } from '../../respond'

/**
 * Simulator-mode gate, not a role gate (design invariant): 404s outside simulated mode, first line, no
 * role check — Snapshots must be reachable even signed out (e.g. right after wiping the world).
 * Wipes the simulated world back to the seed baseline; see simulator-admin.ts.
 */
export async function POST(): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        await resetWorld()
        return new Response(null, { status: 204 })
    })
}
