const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
    void import('keel/adapters/sentry/client').then(({ initClientSentry }) => initClientSentry())
}

export function onRouterTransitionStart(href: string, navigationType: string): void {
    if (!dsn) return
    void import('keel/adapters/sentry/client').then(({ forwardRouterTransition }) =>
        forwardRouterTransition(href, navigationType),
    )
}
