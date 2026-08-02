import * as Sentry from '@sentry/nextjs'
import { scrubEvent } from '../../observability/scrub'

/** Browser Sentry init (ADR-0010) — dynamically imported only when a DSN is configured. */
export function initClientSentry(): void {
    Sentry.init({
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        tracesSampleRate: 0.1,
        beforeSend: (event) => scrubEvent(event),
    })
}

export function forwardRouterTransition(href: string, navigationType: string): void {
    Sentry.captureRouterTransitionStart(href, navigationType)
}
