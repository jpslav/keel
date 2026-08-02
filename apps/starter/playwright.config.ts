import { defineConfig, devices } from '@playwright/test'
import { originFor } from '../../scripts/ports.mjs'

/**
 * A different port from the showcase's: two apps in one repo must be able to run (and be tested) side
 * by side without one silently reusing the other's dev server — the exact failure mode build-notes
 * records for a foreign server squatting :3000.
 *
 * Both numbers now come from scripts/ports.mjs rather than being written here, which extends that same
 * guarantee ACROSS checkouts: a linked worktree gets its own pair, so two agent sessions running e2e
 * at once no longer collide either. `pnpm dev` derives the identical number from the same function.
 */
const BASE_URL = originFor('starter')

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    // This app's whole suite is ONE spec, so it always starts against a cold dev server and pays a
    // full Next compile on every route it touches — sign-in, dashboard, the items route. The default
    // 30s is marginal for that (it timed out on the first run and passed on retry), and there is no
    // warm-up pass to inherit, so the budget is raised rather than left to flake.
    timeout: 60_000,
    expect: { timeout: 15_000 },
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 1,
    // One worker, on CI too — this app's whole suite is one spec, so parallelism buys nothing here,
    // and the showcase's config explains at length why more workers against one shared world costs
    // reliability rather than saving time.
    workers: 1,
    reporter: process.env.CI ? 'github' : 'list',
    use: {
        baseURL: BASE_URL,
        trace: 'on-first-retry',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: 'pnpm dev',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
})
