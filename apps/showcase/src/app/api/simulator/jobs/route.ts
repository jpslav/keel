import { isSimulated } from 'keel/adapters/index'
import { readFlags } from 'keel/adapters/fake/analytics'
import { JOBS_HELD_FLAG, listWorldJobs } from 'keel/adapters/fake/jobs'
import { withPortErrors } from '../../respond'

/**
 * Simulator-mode gate, not a role gate (design invariant): 404s outside simulated mode, first line, no
 * role check. Feeds the Jobs tab's cross-tenant world view — every job across every tenant, plus
 * whether the 'jobs-held' knob is on (held jobs stay 'queued' until the operator steps them forward).
 */
export async function GET(): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        const jobs = await listWorldJobs()
        const held = readFlags()[JOBS_HELD_FLAG] === true
        return Response.json({ jobs, held })
    })
}
