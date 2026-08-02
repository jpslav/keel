import type { MessageTree } from 'keel/i18n/messages'

/**
 * The APP's i18n registration (the seam side of keel/i18n/namespaces.ts, ADR-0012). The catalogs are
 * PHYSICALLY split along the namespace partition: the framework owns FRAMEWORK_NAMESPACES in
 * `packages/keel/src/i18n/messages/*.json`; this app owns APP_NAMESPACES in `apps/showcase/messages/*.json`.
 * Together they partition the merged catalog (DISJOINT + exhaustive), enforced by
 * keel/i18n/namespaces.test.ts.
 *
 * `actors`, `appNotifications` and `tours` are here because the copy for an app-registered Simulator
 * actor, an app-registered notification kind and an app-registered walkthrough belongs to the app that
 * registered it — the framework renders all three surfaces but is handed finished strings (actors),
 * told which namespace to resolve in (notifications), or given a fully-qualified key to resolve with
 * the root translator (tours). A real adopter replaces this list — and the catalogs — with its own.
 */
export const APP_NAMESPACES = [
    'welcome',
    'dashboard',
    'nav',
    'tickets',
    'jobs',
    'escalations',
    'attachments',
    'actors',
    'appNotifications',
    'tours',
] as const

/**
 * The app's catalog for one locale. Framework code (the next-intl request config, the parity tests)
 * reaches the app's messages ONLY through this loader — the seam's one message door.
 */
export async function loadAppMessages(locale: string): Promise<MessageTree> {
    return (await import(`../../messages/${locale}.json`)).default as MessageTree
}
