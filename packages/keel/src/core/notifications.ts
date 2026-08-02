import {
    appNotificationCopy,
    appNotificationKinds,
    type AppNotificationKind,
    type AppNotificationPayloadMap,
} from '@app-config/notifications'

/**
 * The notification registry. PURE TypeScript — imports only the app-config seam (ADR-0006/
 * -0012, lint-enforced): the single source of truth for "what kinds of notification exist, over what
 * channels, and which channels a user's preferences leave enabled", shared VERBATIM by the server
 * fan-out (packages/keel/src/server-lib/notify.ts) and the static-demo twin. Copy is NOT here — it lives in the i18n
 * `notifications` namespace keyed by kind; this module is only the machine-facing shape.
 *
 * FRAMEWORK/APP LINE (ADR-0012): the framework owns the channels + the enabled-channel resolver + its
 * OWN kinds (org.invited, job.completed); app kinds register through the seam (appNotificationKinds),
 * composed below like the migration registry. notificationCopy delegates unknown (app) kinds to
 * appNotificationCopy. An adopter adds kinds by editing src/app-config/notifications.ts.
 */

/** The channels a notification can fan out to. in_app = a `notifications` row (the header bell);
 *  email = the existing email port; sms = the fake SMS channel (a recipe adds a real vendor). */
export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'sms'] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

export function isNotificationChannel(value: string): value is NotificationChannel {
    return (NOTIFICATION_CHANNELS as readonly string[]).includes(value)
}

/**
 * The FRAMEWORK's own notification kinds:
 * - `org.invited` — someone was invited to a team; addressed to the team's OTHER admins (the invitee
 *   has no account yet, so they can't hold an in-app row — see the decision log).
 * - `job.completed` — a user-facing job reached a terminal state; addressed to the team's admins
 *   (jobs carry no creator column — see the decision log). Payload `status` is completed | failed.
 * App kinds register through the seam (src/app-config/notifications.ts).
 */
export const FRAMEWORK_NOTIFICATION_KINDS = ['org.invited', 'job.completed'] as const
type FrameworkNotificationKind = (typeof FRAMEWORK_NOTIFICATION_KINDS)[number]

/** The full kind union: framework base + the app's registered kinds. */
export type NotificationKind = FrameworkNotificationKind | AppNotificationKind

/** The composed registry (framework kinds + app kinds), name-order preserved. */
export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
    ...FRAMEWORK_NOTIFICATION_KINDS,
    ...appNotificationKinds,
]

export function isNotificationKind(value: string): value is NotificationKind {
    return (NOTIFICATION_KINDS as readonly string[]).includes(value)
}

/** Per-kind payload shapes for the framework kinds. Kept small and serializable (jsonb). */
interface FrameworkNotificationPayloadMap {
    'org.invited': { email: string; role: string; orgName: string }
    'job.completed': { jobId: string; jobKind: string; status: 'completed' | 'failed' }
}

/** The composed payload map (framework + app), so NotificationPayload covers every registered kind. */
type NotificationPayloadMap = FrameworkNotificationPayloadMap & AppNotificationPayloadMap

export type NotificationPayload = NotificationPayloadMap[NotificationKind]

/**
 * The i18n key set + interpolation values that render a notification (returned by notificationCopy).
 *
 * `namespace` is filled in by `notificationCopy`, never by the app: a framework kind's copy lives in the
 * framework catalog's `notifications` namespace, an APP kind's in the app catalog's
 * `appNotifications` one. The seam only returns keys, so an app's `appNotificationCopy` is unchanged by
 * this and an app that registers no kinds notices nothing.
 */
export interface NotificationCopy {
    titleKey: string
    bodyKey: string
    smsKey: string
    subjectKey: string
    values: Record<string, string>
    /** Set by notificationCopy; absent from what the seam returns. Callers resolve `${namespace}.${key}`. */
    namespace?: string
}

/** Where a FRAMEWORK kind's copy lives — the framework catalog's own namespace. */
export const FRAMEWORK_NOTIFICATION_NAMESPACE = 'notifications'

/**
 * Where an APP-registered kind's copy lives: a namespace in the APP's catalog, by convention.
 *
 * This closes the last place where adding an app feature meant editing keel's catalog. The framework
 * renders the bell, the emails, the SMS and the prefs grid, so it needs copy for kinds it does not
 * know — and it used to get that by having app keys (`titleOrgRequestReceived` and friends) sit inside
 * its own `notifications` namespace, which the framework/app line forbids. The settlement is option 2
 * of the three that were on the table: the framework declares a copy CONTRACT — "your kinds' copy lives
 * in the `appNotifications` namespace of your catalog, keyed the way notificationCopy says" — and the
 * app satisfies it entirely app-side. The namespace partition test keeps the two halves disjoint.
 */
export const APP_NOTIFICATION_NAMESPACE = 'appNotifications'

/** Which catalog namespace a kind's copy resolves in. Framework kinds are the enumerated ones. */
export function notificationNamespace(kind: NotificationKind): string {
    return (FRAMEWORK_NOTIFICATION_KINDS as readonly string[]).includes(kind)
        ? FRAMEWORK_NOTIFICATION_NAMESPACE
        : APP_NOTIFICATION_NAMESPACE
}

/** One preference row as the resolver sees it (the persisted `notification_prefs` shape, sans ids). */
export interface NotificationPrefRow {
    kind: NotificationKind
    channel: NotificationChannel
    enabled: boolean
}

/**
 * Resolve which channels a notification of `kind` should fan out to, given a user's stored prefs.
 *
 * OPT-OUT / DEFAULT-ON (the recorded posture): every channel is enabled unless the user has an
 * explicit pref row for exactly that (kind, channel) with `enabled = false`. Absence of a row means
 * "on", so a brand-new user (no rows) receives on every channel — the least-surprising default for a
 * template, and the cheapest to persist (rows exist only to record deviations). A stray row with a
 * kind/channel outside the registry is ignored defensively.
 */
export function resolveEnabledChannels(prefs: NotificationPrefRow[], kind: NotificationKind): NotificationChannel[] {
    const disabled = new Set(prefs.filter((p) => p.kind === kind && p.enabled === false).map((p) => p.channel))
    return NOTIFICATION_CHANNELS.filter((channel) => !disabled.has(channel))
}

/** True iff the user's prefs leave `channel` enabled for `kind` (the single-channel form of the above). */
export function isChannelEnabled(
    prefs: NotificationPrefRow[],
    kind: NotificationKind,
    channel: NotificationChannel,
): boolean {
    return resolveEnabledChannels(prefs, kind).includes(channel)
}

/** Unread count over a recipient's notification list — a read row has a non-null `readAt`. Shared by
 *  the bell badge (server + twin) so the two can never compute "unread" differently. */
export function unreadCount(items: { readAt: string | null }[]): number {
    return items.reduce((n, item) => (item.readAt === null ? n + 1 : n), 0)
}

/**
 * Map a notification (kind + payload) to the i18n message keys and interpolation values that render it.
 * PURE and framework-free: it returns RELATIVE keys in the `notifications` namespace plus a values bag,
 * so the SAME mapping drives the email/SMS copy (server, `getTranslations`), the header bell list
 * (client, `useTranslations`), and the static-demo twin — the copy can never drift between surfaces.
 * The job kind splits on status here (completed vs failed) so callers never re-derive that branch. App
 * kinds delegate to appNotificationCopy (the seam), keeping app copy out of the framework switch — and
 * the returned `namespace` tells the caller which CATALOG to resolve those keys in, so app copy stays
 * out of the framework's catalog too.
 */
export function notificationCopy(kind: NotificationKind, payload: NotificationPayload): NotificationCopy {
    return { ...copyKeys(kind, payload), namespace: notificationNamespace(kind) }
}

function copyKeys(kind: NotificationKind, payload: NotificationPayload): NotificationCopy {
    switch (kind) {
        case 'org.invited': {
            const p = payload as FrameworkNotificationPayloadMap['org.invited']
            return {
                titleKey: 'titleOrgInvited',
                bodyKey: 'bodyOrgInvited',
                smsKey: 'smsOrgInvited',
                subjectKey: 'subjectOrgInvited',
                values: { email: p.email, role: p.role, org: p.orgName },
            }
        }
        case 'job.completed': {
            const p = payload as FrameworkNotificationPayloadMap['job.completed']
            const failed = p.status === 'failed'
            return {
                titleKey: failed ? 'titleJobFailed' : 'titleJobCompleted',
                bodyKey: failed ? 'bodyJobFailed' : 'bodyJobCompleted',
                smsKey: failed ? 'smsJobFailed' : 'smsJobCompleted',
                subjectKey: failed ? 'subjectJobFailed' : 'subjectJobCompleted',
                values: { jobKind: p.jobKind },
            }
        }
        default:
            return appNotificationCopy(kind, payload as AppNotificationPayloadMap[AppNotificationKind])
    }
}
