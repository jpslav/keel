import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { contractApps } from './tests/support/contract-apps'

/**
 * Contract tests against real Postgres — slower, separate from the fast unit suite.
 *
 * ONE PROJECT PER APP, PLUS THE FRAMEWORK'S OWN SEAM, each with its own database. Two migration sets cannot share
 * one contract database: they share the framework's 0001–0999 but differ from 1001 up, so running the second
 * set's `migrateToLatest` over a database the first has migrated makes Kysely report corrupted migrations. A
 * project therefore means its OWN aliases AND its own database, which is what each app's contract test asks for
 * (`defineContractSuite`, tests/support/contract-suite.ts, over a `<slug>_contract` database) and what the `keel`
 * project below does (`keel_contract`). Every app's per-app migrations meet real Postgres, and the fakes are held to
 * the real engine for each of them.
 *
 * The apps are DISCOVERED (every `apps/*` with a `tests/contract`, tests/support/contract-apps.ts), not named
 * here, so renaming an app or ejecting the showcase needs no edit to this file. An app that registers
 * migrations and has no contract suite is a failure of tests/tooling/contract-coverage.test.ts, not a silent gap.
 */
const at = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

const appProject = (app: string) => ({
    resolve: {
        alias: {
            '@app-config': at(`./apps/${app}/src/app-config`),
            // the framework package (ADR-0012) — aliased rather than resolved through its exports
            // map so vitest loads the SAME source files the app's tsconfig paths resolve to
            keel: at('./packages/keel/src'),
            '@': at(`./apps/${app}/src`),
        },
    },
    test: {
        name: app,
        include: [`apps/${app}/tests/contract/**/*.test.ts`],
        testTimeout: 120_000,
        hookTimeout: 120_000,
    },
})

export default defineConfig({
    test: {
        // Every project defaults to one embedded-postgres port (scripts/ports.mjs), so their files run
        // one at a time rather than racing for it.
        fileParallelism: false,
        projects: [
            ...contractApps(at('./')).map(appProject),
            {
                // The framework's OWN seam (packages/keel/test-fixture), as vitest.config.ts's `keel`
                // project uses — names no app, so ejecting or renaming one never touches it. Each of its
                // harnesses makes its own database: db.contract.test.ts (the `pg` driver) and
                // rds-data.contract.test.ts (the RDS Data API driver, through its emulator), both in
                // packages/keel/src/adapters/real.
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
