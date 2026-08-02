import { db } from 'keel/adapters/index'
import { isJobStatus, type JobStatus } from 'keel/core/jobs'
import { listServiceJobs } from 'keel/db/jobs'
import { withServiceCaller } from '../respond'

/**
 * Service-caller job poll: an org's jobs newest-first, no timelines (light polling). The caller's
 * org/tenant come from the verified identity — never from the request — so there is no org to pass.
 * Optional `?status=` narrows to one lifecycle state; an unknown value is a 400 invalid-payload.
 */
export const GET = withServiceCaller(async ({ identity, request }) => {
    const raw = new URL(request.url).searchParams.get('status')
    let status: JobStatus | undefined
    if (raw !== null) {
        if (!isJobStatus(raw)) return Response.json({ error: 'invalid-payload' }, { status: 400 })
        status = raw
    }
    const jobs = await listServiceJobs(db, identity.tenantId, identity.orgId, { status })
    return Response.json({ jobs })
})
