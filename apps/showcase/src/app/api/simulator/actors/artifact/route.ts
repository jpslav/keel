import { isSimulated } from 'keel/adapters/index'
import { produceJobArtifact } from 'keel/adapters/fake/jobs'
import { withPortErrors } from '../../../respond'

/**
 * Simulator-mode gate, not a role gate (design invariant): 404s outside simulated mode, first line, no
 * role check. (Re)produces a job's artifact by running its handler — artifact production ONLY, never
 * a status write, so the bundle-analyzer actor can hand the resulting key to the GENUINE service
 * status POST (which owns the timeline). `{ resultKey }` on success, `{ error }` when the handler
 * fails (the actor then reports the job failed), 404 for an unknown (tenantId, jobId) pair.
 */
export async function POST(request: Request): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        const { tenantId, jobId } = (await request.json()) as { tenantId?: unknown; jobId?: unknown }
        if (typeof tenantId !== 'string' || typeof jobId !== 'string') {
            return Response.json({ error: 'invalid-payload' }, { status: 400 })
        }
        return Response.json(await produceJobArtifact(tenantId, jobId))
    })
}
