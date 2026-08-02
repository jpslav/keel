import { auth, db } from 'keel/adapters/index'
import { getNotificationsForRecipient } from 'keel/db/notifications'
import { resolveTenantId } from '../org-context'
import { withPortErrors } from '../respond'

/**
 * The header bell's feed: the signed-in user's recent notifications plus their unread count,
 * RECIPIENT-scoped (a user only ever sees their own rows — an app-level filter on top of the tenant RLS
 * scope). Polled by the header glue on the house polling doctrine; GET-only, so no authorize() (reads
 * are the recipient filter's job). The client renders copy from kind+payload via the shared
 * notificationCopy mapper, so this route ships facts, not presentation strings.
 */
export async function GET(): Promise<Response> {
    return withPortErrors(async () => {
        const user = await auth.requireUser()
        const tenantId = await resolveTenantId(user)
        if (tenantId instanceof Response) return tenantId
        const { items, unread } = await getNotificationsForRecipient(db, tenantId, user.id)
        return Response.json({ items, unread })
    })
}
