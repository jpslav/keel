import { randomBytes } from 'node:crypto'
import { auth, db } from 'keel/adapters/index'
import { authorize } from 'keel/authz/authorize'
import { isWebhookEventKind, type WebhookEventKind } from 'keel/core/webhook-events'
import { recordAuditEvent } from 'keel/db/audit'
import { createEndpoint, listEndpointsForOrg } from 'keel/db/webhooks'
import { resolveOrgContext } from '../org-context'
import { withPortErrors } from '../respond'

/**
 * Outbound webhook endpoints for the active org, managed by an org admin. Every mutation is
 * authorize()-gated (WebhookEndpoint: create = canManageOrg && sameOrg — registering an egress URL is
 * an administrative act). The list never returns the shared secret; POST returns it ONCE (the caller
 * shows it once and it is not retrievable again — house-simple, plaintext at rest; see decision log).
 */
export async function GET(): Promise<Response> {
    return withPortErrors(async () => {
        const user = await auth.requireUser()
        const resolved = await resolveOrgContext(user)
        if (resolved instanceof Response) return resolved
        const { tenantId, orgId } = resolved
        const endpoints = await listEndpointsForOrg(db, tenantId, orgId)
        return Response.json({ endpoints })
    })
}

export async function POST(request: Request): Promise<Response> {
    return withPortErrors(async () => {
        const user = await auth.requireUser()
        const { url, eventKinds } = (await request.json()) as { url?: string; eventKinds?: unknown }

        // Validate the URL is a real http(s) endpoint, and the kinds are a non-empty subset of the registry.
        if (typeof url !== 'string' || !isHttpUrl(url)) {
            return Response.json({ error: 'invalid-url' }, { status: 400 })
        }
        if (!Array.isArray(eventKinds) || eventKinds.length === 0 || !eventKinds.every(isWebhookEventKind)) {
            return Response.json({ error: 'invalid-event-kinds' }, { status: 400 })
        }
        const kinds = [...new Set(eventKinds as WebhookEventKind[])]

        const resolved = await resolveOrgContext(user)
        if (resolved instanceof Response) return resolved
        const { tenantId, orgId } = resolved

        authorize(user, orgId, 'create', { type: 'WebhookEndpoint', orgId })

        // Server-generated shared secret, shown once. node:crypto is a node builtin (not a vendor SDK),
        // so it's allowed outside packages/keel/src/adapters — the service-auth/storage precedent.
        const secret = `whsec_${randomBytes(24).toString('hex')}`
        const { id } = await createEndpoint(db, {
            tenantId,
            orgId,
            url,
            eventKinds: kinds,
            secret,
            createdBy: user.id,
        })
        await recordAuditEvent(db, {
            tenantId,
            orgId,
            actorUserId: user.id,
            action: 'webhook-endpoint.created',
            subjectType: 'WebhookEndpoint',
            subjectId: id,
        })
        return Response.json({ id, secret }, { status: 201 })
    })
}

function isHttpUrl(value: string): boolean {
    try {
        const url = new URL(value)
        return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
        return false
    }
}
