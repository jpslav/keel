/**
 * The FRAMEWORK's reserved i18n namespaces — the top-level keys of the framework catalog
 * (`./messages/*.json`) that the framework owns: shell chrome, auth, profile, org, events, errors,
 * banner, simulator, invite acceptance, email templates, the job-status timeline, and the layered
 * subsystems (agreements, messages/sms, notifications, webhooks). The app's namespaces register through
 * the seam (src/app-config/messages.ts APP_NAMESPACES) and live in the host's `messages/*.json`.
 *
 * FRAMEWORK and APP namespaces are DISJOINT and together partition the merged catalog — enforced by
 * namespaces.test.ts. That partition is PHYSICAL (ADR-0012): two catalogs, deep-merged at
 * every load site (./messages.ts).
 *
 * `jobTimeline` resolves the old `jobs` caveat: the status labels the framework's JobTimeline renders
 * are framework copy, so they split into their own namespace at the catalog split; the app's `jobs`
 * namespace kept the export-card copy.
 */
export const FRAMEWORK_NAMESPACES = [
    'shell',
    'auth',
    'profile',
    'org',
    'events',
    'errors',
    'banner',
    'simulator',
    'acceptInvite',
    'email',
    'agreements',
    'messages',
    'notifications',
    'webhooks',
    'jobTimeline',
] as const
