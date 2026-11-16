import { db } from 'keel/adapters/index'
import { authorize } from 'keel/authz/authorize'
import { exportKeyPrefix, isJobStatus } from 'keel/core/jobs'
import { jobForOrg, recordJobStatus } from 'keel/db/jobs'
import { withServiceCaller } from '../../../respond'

const isOptionalString = (value: unknown): value is string | undefined =>
    value === undefined || typeof value === 'string'

/**
 * Service caller reports a status change for one of ITS OWN jobs. `queued` is rejected (a caller
 * never re-queues) as is any non-status string. The job must belong to the caller's org — a foreign
 * org's job is indistinguishable from a missing one (404), so ids can't be probed. The caller is then
 * authorized as the MACHINE it is (`update Job`, which the framework grants a service-key caller in its
 * own org and nobody else). The transition is validated by recordJobStatus's state machine; an illegal
 * hop surfaces as 409 via withServiceCaller.
 */
export const POST = withServiceCaller<{ id: string }>(async ({ identity, actor, request, params }) => {
    const { id } = params
    const body = (await request.json()) as Record<string, unknown> | null
    if (typeof body !== 'object' || body === null) return Response.json({ error: 'invalid-payload' }, { status: 400 })

    const { status, resultKey, error, message } = body
    if (typeof status !== 'string' || !isJobStatus(status) || status === 'queued') {
        return Response.json({ error: 'invalid-payload' }, { status: 400 })
    }
    if (!isOptionalString(resultKey) || !isOptionalString(error) || !isOptionalString(message)) {
        return Response.json({ error: 'invalid-payload' }, { status: 400 })
    }
    // A caller-supplied resultKey is later signed verbatim by GET /api/jobs, and storage isolation
    // is purely by key convention — so the key MUST stay inside the caller's own ORG namespace
    // (export keys encode tenant AND org for exactly this): a planted foreign key would otherwise
    // become a signed download of another org's — or tenant's — artifact.
    if (resultKey !== undefined && !resultKey.startsWith(exportKeyPrefix(identity.tenantId, identity.orgId))) {
        return Response.json({ error: 'invalid-payload' }, { status: 400 })
    }

    const found = await jobForOrg(db, identity.tenantId, identity.orgId, id)
    if (!found) return Response.json({ error: 'not found' }, { status: 404 })
    // jobForOrg matched the job ONLY within the caller's org, so that org is the subject's.
    authorize(actor, 'update', { type: 'Job', orgId: identity.orgId })

    await recordJobStatus(db, identity.tenantId, id, status, { resultKey, error, message })
    return Response.json({ ok: true })
})
