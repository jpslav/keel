import type { NotificationCopy } from 'keel/core/notifications'

/**
 * The APP's notification kinds (the seam side of keel/core/notifications.ts, ADR-0012). The framework
 * owns the channels, the resolver, and its own kinds (org.invited, job.completed).
 *
 * ONE kind, because `server-lib/notify.test.ts` fans an APP kind out to prove the composed registry and
 * the per-recipient fault isolation work for kinds the framework has never heard of.
 *
 * The KEYS returned below resolve in the APP catalog's `appNotifications` namespace, not the
 * framework's `notifications` one (keel/core/notifications.ts, APP_NOTIFICATION_NAMESPACE) — see
 * ../messages/en.json.
 */
export const appNotificationKinds = ['docket.flagged'] as const
export type AppNotificationKind = (typeof appNotificationKinds)[number]

/** Per-kind payload shapes (jsonb-serializable) for the app kinds. */
export interface AppNotificationPayloadMap {
    'docket.flagged': { docketId: string; label: string; orgName: string }
}

/** Copy mapping for the app kinds — same shape the framework's notificationCopy returns. */
export function appNotificationCopy(
    kind: AppNotificationKind,
    payload: AppNotificationPayloadMap[AppNotificationKind],
): NotificationCopy {
    switch (kind) {
        case 'docket.flagged': {
            const p = payload as AppNotificationPayloadMap['docket.flagged']
            return {
                titleKey: 'titleDocketFlagged',
                bodyKey: 'bodyDocketFlagged',
                smsKey: 'smsDocketFlagged',
                subjectKey: 'subjectDocketFlagged',
                values: { label: p.label, org: p.orgName },
            }
        }
    }
}
