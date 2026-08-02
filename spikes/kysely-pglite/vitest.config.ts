import { defineConfig } from 'vitest/config'

/**
 * A LOCAL config, not a project in the root's `vitest.config.ts`.
 *
 * Without this file, `pnpm --filter spike-kysely-pglite test` (`vitest run`) finds no config in this
 * directory and Vite's upward search picks up the ROOT config instead — whose four projects
 * (`showcase`, `starter`, `keel`, `repo`) all name an `include` glob that starts under `apps/`,
 * `packages/` or `tests/`, none of which matches anything under `spikes/`. The result is a silent
 * "No test files found, exiting with code 1" — the one thing `docs/provenance.md` points a reader at
 * to verify for themselves, broken.
 *
 * This is deliberately NOT fixed by adding a `spikes` project to the root config instead. The spike is
 * a historical artifact — it proved the tenancy decision BEFORE the framework existed, and has no
 * ongoing job. Joining the root config would put it on the main verify path (`pnpm test:unit`,
 * `pnpm verify`) and let it start gating CI, which is exactly the opposite of "prove it once, write it
 * down, move on." A local config keeps it reproducible (`pnpm --filter spike-kysely-pglite test`
 * still works, from anywhere) without giving it a vote over anything.
 */
export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
        environment: 'node',
    },
})
