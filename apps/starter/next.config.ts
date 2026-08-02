import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

// The request config lives in the framework package (ADR-0012), so the plugin is pointed at it
// explicitly — next-intl's default lookup only knows ./src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin('../../packages/keel/src/i18n/request.ts')

/**
 * The starter's Next config, deliberately shorter than the showcase's: no Sentry wrapper (that is a
 * cutover row, and the adapter is inert without a DSN), no Panda/PostCSS pipeline (Mantine ships its
 * own reset), no `@app/seed` in transpilePackages — the starter's seed world lives inside the app.
 */
const nextConfig: NextConfig = {
    // The deployed artifact is this same standalone server in a Lambda (ADR-0001).
    output: 'standalone',
    typedRoutes: true,
    transpilePackages: ['keel'],
    // Native/WASM server deps stay external so their runtime file loading keeps working.
    serverExternalPackages: ['@electric-sql/pglite', 'pg'],
}

export default withNextIntl(nextConfig)
