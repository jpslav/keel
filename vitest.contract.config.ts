import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Contract tests against real Postgres — slower, separate from the fast unit suite.
 *
 * ONE APP, PLUS THE FRAMEWORK'S OWN SEAM — unlike vitest.config.ts's per-app projects. Two migration
 * sets cannot share one contract database: they share the framework's 0001–0999 but differ from 1001
 * up, so running the second set's `migrateToLatest` over a database the first has migrated makes Kysely
 * report corrupted migrations. A second contract run therefore means a project with its OWN aliases AND
 * its own database — which is exactly what the `keel` project below is (it creates `keel_contract`).
 * `apps/starter` has no such project yet, so it proves its `items` RLS on pglite only, via the same
 * composed runner (keel/db/rls-pglite.test.ts, run under the `starter` vitest project).
 *
 * CONTRACT_APP is this file's only app knowledge; `scripts/init-app.ts` rewrites that one literal
 * (and moves the harness) when an app is renamed or the showcase is ejected.
 */
const CONTRACT_APP = 'showcase'

const at = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

export default defineConfig({
    test: {
        // Both projects default to one embedded-postgres port (scripts/ports.mjs), so their files run
        // one at a time rather than racing for it.
        fileParallelism: false,
        projects: [
            {
                resolve: {
                    alias: {
                        '@app-config': at(`./apps/${CONTRACT_APP}/src/app-config`),
                        // the framework package (ADR-0012) — aliased rather than resolved through its exports
                        // map so vitest loads the SAME source files the app's tsconfig paths resolve to
                        keel: at('./packages/keel/src'),
                        '@': at(`./apps/${CONTRACT_APP}/src`),
                    },
                },
                test: {
                    name: CONTRACT_APP,
                    include: [`apps/${CONTRACT_APP}/tests/contract/**/*.test.ts`],
                    testTimeout: 120_000,
                    hookTimeout: 120_000,
                },
            },
            {
                // The framework's OWN seam (packages/keel/test-fixture), as vitest.config.ts's `keel`
                // project uses — names no app, so ejecting or renaming one never touches it. Its harness
                // makes its own database (see packages/keel/src/adapters/real/db.contract.test.ts).
                resolve: {
                    alias: {
                        '@app-config': at('./packages/keel/test-fixture/app-config'),
                        keel: at('./packages/keel/src'),
                    },
                },
                test: {
                    name: 'keel',
                    include: ['packages/*/src/**/*.contract.test.ts'],
                    testTimeout: 120_000,
                    hookTimeout: 120_000,
                },
            },
        ],
    },
})
