import { defineConfig, devices } from '@playwright/test'
import { originFor } from '../../scripts/ports.mjs'

// Derived, not literal: a linked worktree under .claude/worktrees/ gets its own port, so a second
// agent session's dev server can never be silently adopted by this one's suite (scripts/ports.mjs).
// The `pnpm dev` below computes the same number from the same function, so the two cannot disagree.
const BASE_URL = originFor('showcase')

/**
 * Run against a PRODUCTION build instead of `next dev`. CI sets this; local does not.
 *
 * Every inflated timeout in this repo — 15s expect, 60s here, 120s destructive, the 90s gotos —
 * exists to absorb `next dev`'s on-demand compilation, and CI pays roughly 3x for it. A production
 * build removes the compile entirely. It also closes a real gap: without this, CI never runs
 * `next build` at all, so a change that breaks the production build ships green.
 *
 * Local stays on dev deliberately: `reuseExistingServer` keeps a warm server across runs, and a
 * build per attempt would cost more than the compiles it saves.
 */
const E2E_BUILD = process.env.E2E_BUILD === '1'

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    // First hits compile routes on the dev server; give assertions room for cold compiles,
    // and one local retry — parallel first-compiles can transiently fail a page load.
    expect: { timeout: 15_000 },
    // The same reasoning the starter's config already applies to itself, and for the same reason:
    // routes compile on demand, so a test's budget has to cover a compile it did not cause. Playwright's
    // 30s default was survivable only while `workers` was pinned to 1 — measured at 3 workers, the two
    // navigation-heaviest specs (simulator-panel continuity, tenancy) blow through 30s while the dev
    // server serialises their compiles, and fail as bare waitForURL timeouts. Raising the budget does
    // not slow a passing test; it stops a queued compile being reported as a product bug.
    timeout: 60_000,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 1,
    // ONE WORKER, AND NOT BECAUSE OF MEMORY.
    //
    // This was long justified by "the dev VM has 10GB RAM; parallel Chromium renderers get
    // OOM-killed". Measured 2026-07-31 on a 10-core/64GB machine, where memory cannot be the limit,
    // the flake count still rose monotonically with parallelism over the SAME 56 tests:
    //
    //     workers=1 → 0 flaky      workers=3 → 2 flaky
    //     workers=2 → 1 flaky      workers=4 → 2 flaky
    //
    // The cause is the shared world, not the renderers: every worker drives ONE dev server holding
    // ONE `.data`, so specs mutate each other's state. At 5 workers it USED TO degrade further into
    // outright corruption — concurrent non-atomic writeFileSync calls interleaved and left a
    // half-overwritten file ("Unexpected non-whitespace character after JSON at position 751",
    // observed on a 821-byte invites.json). That half is fixed: adapters/fake/atomic-write.ts writes
    // via a colocated temp file + rename, so a reader never sees a spliced file. It does NOT fix lost
    // updates, which is why this number stays at 1. The repeat offenders are the specs that write shared
    // state: tenancy.spec.ts and the demo-banner flag — and tenancy.spec.ts is the very test
    // docs/build-notes.md:296 records as a recurring CI flake, which is this same bug, since CI
    // runs the default worker count.
    //
    // So parallelism is bought where the worlds are genuinely separate — across apps locally, across
    // shards on CI — never inside one server. Raising this number requires per-worker world
    // isolation first: .claude/future-tasks/e2e-shared-world-blocks-parallelism.md.
    workers: 1,
    reporter: process.env.CI ? 'github' : 'list',
    use: {
        baseURL: BASE_URL,
        trace: 'on-first-retry',
    },
    projects: [
        // Snapshots' destructive spec wipes .data (reset/restore) — it must not race the fullyParallel
        // main suite's own assumptions (seed people present, specific files/state), so it's a
        // separate project that only starts once every 'chromium' test has finished.
        //
        // The `dependencies` link below orders the two projects for a bare `playwright test`, but it
        // does NOT serialize the destructive specs against EACH OTHER, and all nine of them mutate the
        // same shared world (.data): snapshot resets, mail clears, webhook failure toggles, world-clock
        // jumps. `mode: 'serial'` inside a file only orders that file. Locally `workers: 1` hid this
        // completely; in CI, where workers default to the core count, destructive spec FILES run in
        // parallel and one spec's "reset world" can pull the floor out from under another's signed-in
        // page. Playwright has no per-project worker count, so `pnpm test:e2e` runs two passes and
        // pins the destructive one to a single worker (`--no-deps`, since the script already ordered
        // them). Run the projects individually and you get the same order for free.
        { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: '**/destructive/**' },
        {
            name: 'destructive',
            use: { ...devices['Desktop Chrome'] },
            testDir: './tests/e2e/destructive',
            dependencies: ['chromium'],
            // Because `pnpm test:e2e` runs this as its OWN playwright invocation (see above), and CI
            // sets reuseExistingServer:false, this pass starts against a COLD dev server — every route
            // it touches pays a full Next dev compile on first hit instead of inheriting the warm
            // server the main pass left behind. The default 30s test timeout is marginal for that on a
            // CI runner and fails intermittently on whichever spec happens to hit an uncompiled route.
            // Measured 2026-07-31: this project takes 2.2 min locally and ~6.7 min on a CI runner for the
            // same 14 tests — 3x. At that ratio a 20s local test lands exactly on a 60s budget, which is
            // why the failures were intermittent, always a bare waitForURL timeout, and never locally
            // reproducible (three ordering experiments, all green). 120s is that measurement, not a guess.
            timeout: 120_000,
        },
    ],
    webServer: {
        command: E2E_BUILD ? 'pnpm run build:e2e && pnpm run start:e2e' : 'pnpm dev',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        // A production build has to compile before it can serve; dev serves immediately and compiles
        // per-route as tests hit it.
        timeout: E2E_BUILD ? 420_000 : 120_000,
    },
})
