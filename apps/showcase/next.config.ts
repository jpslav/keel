import { withSentryConfig } from '@sentry/nextjs'
import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
import { params } from './config/params'

// The request config moved into the framework package (ADR-0012), so the plugin is pointed at it
// explicitly — next-intl's default lookup only knows ./src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin('../../packages/keel/src/i18n/request.ts')

const nextConfig: NextConfig = {
    // The deployed artifact is this same standalone server in a Lambda (ADR-0001).
    output: 'standalone',
    typedRoutes: true,
    transpilePackages: ['@app/seed', 'keel'],
    // Native/WASM server deps stay external so their runtime file loading keeps working.
    serverExternalPackages: ['@electric-sql/pglite', 'pg'],
}

// Sentry wraps the build ONLY when a DSN exists (cutover row `errors`) — hermetic builds make
// zero network calls and skip sourcemap upload entirely.
export default process.env.NEXT_PUBLIC_SENTRY_DSN
    ? withSentryConfig(withNextIntl(nextConfig), {
          org: params.sentry.org,
          project: params.sentry.project,
          silent: true,
      })
    : withNextIntl(nextConfig)
