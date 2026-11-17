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
    // Without this, `next dev` writes an AGENTS.md into the app whenever it detects an AI coding agent,
    // and an agent's `pnpm verify` leaves it untracked. keel's agent guide is the root CLAUDE.md
    // (decision-log, 2026-11-16). Option defined in
    // node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/agentRules.md
    agentRules: false,
    experimental: {
        // Off because `pnpm dev` must make no network calls (CLAUDE.md). By default every `next dev`
        // outside CI queries npm's advisory feed for the installed next (so does `next build` run by an
        // agent or at a prompting terminal), and an agent's run stops when an advisory matches
        // (build-notes, 2026-11-16). Option defined in
        // node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/agentUpgrade.md
        agentUpgrade: false,
    },
}

export default withNextIntl(nextConfig)
