import type { MessageTree } from 'keel/i18n/messages'

/**
 * The APP's i18n registration (the seam side of keel/i18n/namespaces.ts, ADR-0012). The catalogs are
 * physically split: the framework owns FRAMEWORK_NAMESPACES in `packages/keel/src/i18n/messages/*.json`;
 * this fixture owns APP_NAMESPACES in `../messages/*.json`. Together they partition the merged catalog
 * (disjoint + exhaustive) — which is exactly what keel/i18n/namespaces.test.ts checks, and it runs
 * against this seam as well as against every real app's.
 *
 * `appNotifications` is not decoration: keel/core/notifications.ts declares that an APP-registered
 * notification kind's copy lives in that namespace of the APP's catalog, so registering `docket.flagged`
 * in ./notifications.ts obliges this half to carry its four keys.
 */
export const APP_NAMESPACES = ['appNotifications', 'fixture'] as const

/**
 * The fixture's catalog for one locale. Framework code (the next-intl request config, the parity tests)
 * reaches the app's messages ONLY through this loader — the seam's one message door.
 */
export async function loadAppMessages(locale: string): Promise<MessageTree> {
    return (await import(`../messages/${locale}.json`)).default as MessageTree
}
