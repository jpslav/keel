import type { NotificationCopy } from 'keel/core/notifications'

/**
 * The APP's notification kinds (the seam side of packages/keel/src/core/notifications.ts, ADR-0012). The framework
 * owns the channels + resolver + its own kinds; the app registers its OWN kinds, payload shapes, and
 * copy mapping here. A real adopter replaces this file. PURE TypeScript, framework-free.
 *
 * The KEYS returned below resolve in the APP catalog's `appNotifications` namespace, not the
 * framework's `notifications` one — the framework renders the bell, the email and the prefs grid, but
 * it resolves an app kind's copy in the app's own catalog (keel/core/notifications.ts,
 * APP_NOTIFICATION_NAMESPACE). Registering a kind therefore never means editing keel's catalog.
 *
 * TWO kinds, because the interesting question about a notification registry is whether a SECOND kind
 * composes — different audience, different trigger, same fan-out:
 * - `escalation.received` — a desk handed work to another team; addressed to the RECEIVING team's
 *   admins (the bell rises on the other team, the headline cross-team flow).
 * - `ticket.assigned` — a ticket was handed to a specific person; addressed to THAT PERSON, not to a
 *   team's admins. It is the registry's proof that recipient selection is the caller's business.
 */
export const appNotificationKinds = ['escalation.received', 'ticket.assigned'] as const
export type AppNotificationKind = (typeof appNotificationKinds)[number]

/** Per-kind payload shapes (jsonb-serializable) for the app kinds — the machine-readable facts. */
export interface AppNotificationPayloadMap {
    'escalation.received': { escalationId: string; subject: string; requesterOrgName: string }
    'ticket.assigned': { ticketId: string; ref: string; subject: string; assignedByName: string }
}

/** Copy mapping for the app kinds — same shape the framework's notificationCopy returns. */
export function appNotificationCopy(
    kind: AppNotificationKind,
    payload: AppNotificationPayloadMap[AppNotificationKind],
): NotificationCopy {
    switch (kind) {
        case 'escalation.received': {
            const p = payload as AppNotificationPayloadMap['escalation.received']
            return {
                titleKey: 'titleEscalationReceived',
                bodyKey: 'bodyEscalationReceived',
                smsKey: 'smsEscalationReceived',
                subjectKey: 'subjectEscalationReceived',
                values: { subject: p.subject, org: p.requesterOrgName },
            }
        }
        case 'ticket.assigned': {
            const p = payload as AppNotificationPayloadMap['ticket.assigned']
            return {
                titleKey: 'titleTicketAssigned',
                bodyKey: 'bodyTicketAssigned',
                smsKey: 'smsTicketAssigned',
                subjectKey: 'subjectTicketAssigned',
                values: { ref: p.ref, subject: p.subject, by: p.assignedByName },
            }
        }
    }
}
