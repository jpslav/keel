import type { NotificationCopy } from 'keel/core/notifications'

/**
 * The APP's notification kinds (the seam side of keel/core/notifications.ts, ADR-0012). The framework
 * owns the channels, the resolver, and its own kinds (org.invited, job.completed).
 *
 * EMPTY REGISTRATION: no app kinds. The bell, the prefs screen, email and SMS fan-out all keep working
 * on the framework's kinds.
 */
export const appNotificationKinds = [] as const
export type AppNotificationKind = (typeof appNotificationKinds)[number]

/** Per-kind payload shapes for the app kinds. There are none, so this contributes nothing to the
 *  intersection the framework builds (`Framework & App`). */
export type AppNotificationPayloadMap = Record<never, never>

/**
 * Copy mapping for the app kinds. Unreachable by construction: the framework's `default:` case
 * delegates here only for a kind outside its own union, and this app registers none — so both
 * parameters are `never`. Returning one is the type-safe way to say "cannot happen"; inventing a
 * placeholder NotificationCopy would be a lie the compiler could not check.
 *
 * Worth naming as a rough edge in the seam: an app that registers zero notification kinds still has
 * to write this function, because the framework calls it unconditionally from the switch's default.
 */
export function appNotificationCopy(
    kind: AppNotificationKind,
    payload: AppNotificationPayloadMap[AppNotificationKind],
): NotificationCopy {
    return payload ?? kind
}
