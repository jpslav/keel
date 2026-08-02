import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Contract tests against real Postgres — slower, separate from the fast unit suite.
 *
 * SINGLE-APP BY CONSTRUCTION, unlike vitest.config.ts's per-app projects. Two apps cannot share one
 * contract database: their migration sets share the framework's 0001–0999 but differ from 1001 up, so
 * running the second app's `migrateToLatest` over a database the first has migrated makes Kysely
 * report corrupted migrations. Giving a second app a contract run means a project with its OWN
 * aliases AND its own database. `apps/starter` therefore proves its `items` RLS on pglite only, via
 * the same composed runner (keel/db/rls-pglite.test.ts, run under the `starter` vitest project).
 *
 * CONTRACT_APP is this file's only app knowledge; `scripts/init-app.ts` rewrites that one literal
 * (and moves the harness) when an app is renamed or the showcase is ejected.
 */
const CONTRACT_APP = 'showcase'

export default defineConfig({
    resolve: {
        alias: {
            '@app-config': fileURLToPath(new URL(`./apps/${CONTRACT_APP}/src/app-config`, import.meta.url)),
            // the framework package (ADR-0012) — aliased rather than resolved through its exports
            // map so vitest loads the SAME source files the app's tsconfig paths resolve to
            keel: fileURLToPath(new URL('./packages/keel/src', import.meta.url)),
            '@': fileURLToPath(new URL(`./apps/${CONTRACT_APP}/src`, import.meta.url)),
        },
    },
    test: {
        include: [`apps/${CONTRACT_APP}/tests/contract/**/*.test.ts`],
        testTimeout: 120_000,
        hookTimeout: 120_000,
    },
})
