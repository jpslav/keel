import { auth, db } from 'keel/adapters/index'
import { authorize } from 'keel/authz/authorize'
import { isNotificationChannel, isNotificationKind } from 'keel/core/notifications'
import { readPrefRows, setPref } from 'keel/db/notifications'
import { resolveOrgContext } from '../org-context'
import { withPortErrors } from '../respond'

/**
 * Notification preferences, scoped to the caller's ACTIVE org (prefs are org-scoped so a user
 * in two teams can differ per team; the fan-out reads prefs by the notification's org, always one the
 * recipient belongs to). GET returns the caller's stored opt-out rows (the UI derives the default-on
 * grid via the shared core resolver); POST upserts one (kind, channel) toggle. A user manages ONLY their
 * own prefs — authorize() with a self-only NotificationPref subject, and the userId is always the
 * session's, never client-supplied.
 */
export async function GET(): Promise<Response> {
    return withPortErrors(async () => {
        const user = await auth.requireUser()
        const resolved = await resolveOrgContext(user)
        if (resolved instanceof Response) return resolved
        const { tenantId, orgId } = resolved
        const prefs = await readPrefRows(db, tenantId, orgId, user.id)
        return Response.json({ prefs })
    })
}

export async function POST(request: Request): Promise<Response> {
    return withPortErrors(async () => {
        const user = await auth.requireUser()
        authorize(user, user.orgSlug, 'update', { type: 'NotificationPref', ownerId: user.id })
        const resolved = await resolveOrgContext(user)
        if (resolved instanceof Response) return resolved
        const { tenantId, orgId } = resolved
        const body = (await request.json()) as { kind?: unknown; channel?: unknown; enabled?: unknown }
        const { kind, channel, enabled } = body
        if (
            typeof kind !== 'string' ||
            !isNotificationKind(kind) ||
            typeof channel !== 'string' ||
            !isNotificationChannel(channel) ||
            typeof enabled !== 'boolean'
        ) {
            return Response.json({ error: 'invalid-pref' }, { status: 400 })
        }
        await setPref(db, { tenantId, orgId, userId: user.id, kind, channel, enabled }, new Date())
        return Response.json({ ok: true })
    })
}
