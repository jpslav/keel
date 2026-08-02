import { isSimulated } from 'keel/adapters/index'
import { listPendingBuilds } from 'keel/adapters/fake/jobs'
import { withPortErrors } from '../../../respond'

/**
 * Simulator-mode gate, not a role gate (design invariant): 404s outside simulated mode, first line, no
 * role check. Feeds the partner-desk actor its work pool — every non-terminal job across every
 * tenant whose org is NOT a service-managed one, oldest-first (see serviceManagedOrgSlugs in
 * src/app-config/jobs.ts). Mode-only, no
 * auth: the actor frame runs signed-out, exactly like the rest of /api/simulator/*.
 */
export async function GET(): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        const builds = await listPendingBuilds()
        return Response.json({ builds })
    })
}
