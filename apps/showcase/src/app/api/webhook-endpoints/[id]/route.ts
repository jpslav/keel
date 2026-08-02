import { auth, db } from 'keel/adapters/index'
import { authorize } from 'keel/authz/authorize'
import { recordAuditEvent } from 'keel/db/audit'
import { orgIdForSlug } from 'keel/db/org-lookup'
import { tenantIdForSlug } from 'keel/db/tenant-lookup'
import { deleteEndpoint, endpointForOrg, setEndpointEnabled } from 'keel/db/webhooks'
import type { AuthUser } from 'keel/ports/auth'
import { NotFoundError } from 'keel/ports/errors'
import { withPortErrors } from '../../respond'

/**
 * Enable/disable (PATCH) or remove (DELETE) one of the active org's webhook endpoints — both
 * authorize()-gated (WebhookEndpoint update/delete = canManageOrg && sameOrg). The endpoint must
 * belong to the active org (endpointForOrg → 404 otherwise, so ids can't be probed — the jobForOrg
 * doctrine). Deleting an endpoint cascades its deliveries (migration 0010).
 */
async function resolve(user: AuthUser, endpointId: string): Promise<{ tenantId: string; orgId: string }> {
    const tenantId = await tenantIdForSlug(db, user.tenantSlug)
    if (!tenantId) throw new NotFoundError('unknown tenant')
    const orgId = await orgIdForSlug(db, tenantId, user.orgSlug)
    if (!orgId) throw new NotFoundError('unknown org')
    const found = await endpointForOrg(db, tenantId, orgId, endpointId)
    if (!found) throw new NotFoundError('endpoint not found')
    return { tenantId, orgId }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
    return withPortErrors(async () => {
        const user = await auth.requireUser()
        const { id } = await context.params
        const { enabled } = (await request.json()) as { enabled?: unknown }
        if (typeof enabled !== 'boolean') return Response.json({ error: 'invalid-request' }, { status: 400 })

        const { tenantId, orgId } = await resolve(user, id)
        authorize(user, orgId, 'update', { type: 'WebhookEndpoint', orgId })
        await setEndpointEnabled(db, tenantId, id, enabled)
        await recordAuditEvent(db, {
            tenantId,
            orgId,
            actorUserId: user.id,
            action: enabled ? 'webhook-endpoint.enabled' : 'webhook-endpoint.disabled',
            subjectType: 'WebhookEndpoint',
            subjectId: id,
        })
        return Response.json({ id, enabled })
    })
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
    return withPortErrors(async () => {
        const user = await auth.requireUser()
        const { id } = await context.params

        const { tenantId, orgId } = await resolve(user, id)
        authorize(user, orgId, 'delete', { type: 'WebhookEndpoint', orgId })
        await deleteEndpoint(db, tenantId, id)
        await recordAuditEvent(db, {
            tenantId,
            orgId,
            actorUserId: user.id,
            action: 'webhook-endpoint.deleted',
            subjectType: 'WebhookEndpoint',
            subjectId: id,
        })
        return Response.json({ id })
    })
}
