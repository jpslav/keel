import * as Sentry from '@sentry/nextjs'
import { scrubEvent } from '../../observability/scrub'

/**
 * Server/edge Sentry init (ADR-0010). Loaded ONLY when a DSN is configured (cutover row
 * `errors`) — importing @sentry/nextjs at all pulls OpenTelemetry hooks into every request, so
 * src/instrumentation.ts gates the dynamic import on the DSN.
 */
export function initServerSentry(): void {
    Sentry.init({
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        tracesSampleRate: 0.1,
        beforeSend: (event) => scrubEvent(event),
    })
}
