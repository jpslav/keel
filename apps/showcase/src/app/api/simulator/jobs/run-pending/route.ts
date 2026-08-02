import { isSimulated } from 'keel/adapters/index'
import { runPendingJobs } from 'keel/adapters/fake/jobs'
import { withPortErrors } from '../../../respond'

/**
 * Simulator-mode gate, not a role gate (design invariant): 404s outside simulated mode, first line, no
 * role check. The operator's "step the held world forward" action — runs every currently-queued job
 * across all tenants regardless of the 'jobs-held' knob and reports how many ran.
 */
export async function POST(): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        const ran = await runPendingJobs()
        return Response.json({ ran })
    })
}
