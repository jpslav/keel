import {
    type NotificationChannel,
    type NotificationKind,
    type NotificationPayload,
    type NotificationPrefRow,
    isNotificationChannel,
    isNotificationKind,
} from '../core/notifications'
import type { DbPort } from '../ports/db'
import { jsonb } from './jsonb'
import { toIso } from './jobs'

/**
 * The notifications DB layer. Every function goes through db.withTenant — RLS is the tenant
 * boundary; the RECIPIENT scope (a user only sees/marks THEIR OWN rows) is an app-level WHERE on top,
 * the same rls-independent second filter jobs uses for org. No cross-tenant world view here: the
 * in-app bell is product UI walked as a person, and the Simulator world surface for this slice is the
 * SMS catch-store, not the notifications table.
 */

export interface NotificationView {
    id: string
    kind: NotificationKind
    payload: NotificationPayload
    readAt: string | null
    createdAt: string
}

/** Insert one in-app notification row (the in_app channel). Tenant-scoped; the recipient is opaque. */
export async function insertNotification(
    db: DbPort,
    input: {
        tenantId: string
        orgId: string
        recipientUserId: string
        kind: NotificationKind
        payload: NotificationPayload
    },
): Promise<{ id: string }> {
    return db.withTenant(input.tenantId, (trx) =>
        trx
            .insertInto('notifications')
            .values({
                tenant_id: input.tenantId,
                org_id: input.orgId,
                recipient_user_id: input.recipientUserId,
                kind: input.kind,
                payload: jsonb(input.payload),
            })
            .returning('id')
            .executeTakeFirstOrThrow(),
    )
}

/**
 * A recipient's recent notifications (newest-first, capped) PLUS their true unread count (counted over
 * ALL their rows, not just the returned page — the bell badge must not under-count when the list is
 * truncated). Two queries, one tenant-scoped transaction. Recipient-scoped: a user can never read
 * another user's rows even within the same tenant.
 */
export async function getNotificationsForRecipient(
    db: DbPort,
    tenantId: string,
    recipientUserId: string,
    opts?: { limit?: number },
): Promise<{ items: NotificationView[]; unread: number }> {
    const limit = opts?.limit ?? 20
    return db.withTenant(tenantId, async (trx) => {
        const rows = await trx
            .selectFrom('notifications')
            .select(['id', 'kind', 'payload', 'read_at', 'created_at'])
            .where('recipient_user_id', '=', recipientUserId)
            .orderBy('created_at', 'desc')
            .limit(limit)
            .execute()
        const unreadRow = await trx
            .selectFrom('notifications')
            .select((eb) => eb.fn.countAll<number>().as('n'))
            .where('recipient_user_id', '=', recipientUserId)
            .where('read_at', 'is', null)
            .executeTakeFirst()
        return {
            items: rows.map((r) => ({
                id: r.id,
                kind: r.kind as NotificationKind,
                payload: r.payload as NotificationPayload,
                readAt: r.read_at ? toIso(r.read_at) : null,
                createdAt: toIso(r.created_at),
            })),
            unread: Number(unreadRow?.n ?? 0),
        }
    })
}

/**
 * Marks a recipient's notifications read (sets read_at = now). Recipient-scoped in the WHERE clause so
 * a user can only ever mark THEIR OWN rows — the rls-independent recipient guard behind the route's
 * authorize(). `ids` narrows to specific rows; omitted = mark ALL of the recipient's unread. Already-read
 * rows are left untouched (read_at IS NULL guard) so createdAt/read ordering stays stable. Returns the
 * number of rows changed.
 */
export async function markNotificationsRead(
    db: DbPort,
    tenantId: string,
    recipientUserId: string,
    now: Date,
    ids?: string[],
): Promise<number> {
    if (ids && ids.length === 0) return 0
    return db.withTenant(tenantId, async (trx) => {
        const result = await trx
            .updateTable('notifications')
            .set({ read_at: now })
            .where('recipient_user_id', '=', recipientUserId)
            .where('read_at', 'is', null)
            .$if(ids !== undefined, (qb) => qb.where('id', 'in', ids!))
            .execute()
        return Number(result[0]?.numUpdatedRows ?? 0)
    })
}

/**
 * A user's stored preference rows for one org (the OPT-OUT overrides — absence means enabled). The
 * caller (fan-out or the profile grid) feeds these to resolveEnabledChannels; the resolver, not this
 * query, encodes the default-on posture. Rows with an unknown kind/channel are dropped defensively so
 * a stale registry entry can't widen the type.
 */
export async function readPrefRows(
    db: DbPort,
    tenantId: string,
    orgId: string,
    userId: string,
): Promise<NotificationPrefRow[]> {
    return db.withTenant(tenantId, async (trx) => {
        const rows = await trx
            .selectFrom('notification_prefs')
            .select(['kind', 'channel', 'enabled'])
            .where('org_id', '=', orgId)
            .where('user_id', '=', userId)
            .execute()
        return rows.flatMap((r) =>
            isNotificationKind(r.kind) && isNotificationChannel(r.channel)
                ? [{ kind: r.kind, channel: r.channel, enabled: r.enabled }]
                : [],
        )
    })
}

/**
 * Upserts one (user, org, kind, channel) preference. The unique index (tenant_id, org_id, user_id,
 * kind, channel) is the conflict target, so a repeat toggle updates in place rather than piling rows.
 * A user may only ever write their OWN prefs — enforced at the route (authorize + the userId is the
 * session's, never client-supplied).
 */
export async function setPref(
    db: DbPort,
    input: {
        tenantId: string
        orgId: string
        userId: string
        kind: NotificationKind
        channel: NotificationChannel
        enabled: boolean
    },
    now: Date,
): Promise<void> {
    await db.withTenant(input.tenantId, (trx) =>
        trx
            .insertInto('notification_prefs')
            .values({
                tenant_id: input.tenantId,
                org_id: input.orgId,
                user_id: input.userId,
                kind: input.kind,
                channel: input.channel,
                enabled: input.enabled,
            })
            .onConflict((oc) =>
                oc
                    .columns(['tenant_id', 'org_id', 'user_id', 'kind', 'channel'])
                    .doUpdateSet({ enabled: input.enabled, updated_at: now.toISOString() }),
            )
            .execute(),
    )
}
