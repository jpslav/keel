/**
 * Next instrumentation hook. The Sentry SDK is loaded ONLY when a DSN exists — hermetic
 * dev/demo/e2e never pay its OpenTelemetry request-hook cost (it measurably slows `next dev`).
 */
export async function register(): Promise<void> {
    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return
    if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
        const { initServerSentry } = await import('keel/adapters/sentry/init')
        initServerSentry()
    }
}
