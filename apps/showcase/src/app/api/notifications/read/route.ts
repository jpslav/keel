import { auth, db } from 'keel/adapters/index'
import { authorize } from 'keel/authz/authorize'
import { markNotificationsRead } from 'keel/db/notifications'
import { resolveTenantId } from '../../org-context'
import { withPortErrors } from '../../respond'

/**
 * Mark the caller's notifications read. authorize() with a self-only Notification subject is
 * the choke point; the mark query is ALSO recipient-scoped (WHERE recipient_user_id = the session user)
 * so a user can never mark another's rows even if the ability check were wrong — belt and braces. Body
 * `{ ids?: string[] }` narrows to specific rows; omitted = mark ALL the caller's unread (the bell marks
 * all on open — see the decision log). Returns how many rows flipped.
 */
export async function POST(request: Request): Promise<Response> {
    return withPortErrors(async () => {
        const user = await auth.requireUser()
        authorize(user, user.orgSlug, 'update', { type: 'Notification', ownerId: user.id })
        const tenantId = await resolveTenantId(user)
        if (tenantId instanceof Response) return tenantId
        const body = (await request.json().catch(() => ({}))) as { ids?: unknown }
        const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : undefined
        const marked = await markNotificationsRead(db, tenantId, user.id, new Date(), ids)
        return Response.json({ marked })
    })
}
