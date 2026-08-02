# Run CI's e2e against a production build, not `next dev`

**RESOLVED 2026-07-31** (`fix/e2e-world-isolation`). `E2E_BUILD=1` is implemented exactly as route 2
below describes: an explicit opt-in on the fail-closed guard, proven still closed by
`packages/keel/src/adapters/production-guard.test.ts` (including a negative-control run with the flag
planted in `infra/stack.ts`). CI's e2e shards set it. Measured: the destructive project 132s → 57s,
chromium 56 passed with no flakes, and CI runs `next build` for the first time. The analysis below is
kept because it is why the design is what it is.

**Resolved for the SHOWCASE only — the starter shard was missed.** `apps/showcase/playwright.config.ts`
branches `webServer.command` on `E2E_BUILD`; `apps/starter/playwright.config.ts` does not (its command is
a hard-coded `pnpm dev`), and `apps/starter/package.json` has no `build:e2e`/`start:e2e` to branch to. CI
sets `E2E_BUILD: '1'` on the whole `e2e` matrix, so the `starter` shard carries the flag and silently
ignores it. Written up as its own open task: `.claude/future-tasks/starter-e2e-ignores-e2e-build.md`.

**Was:** P2 — the largest remaining CI speed lever, and it would add build coverage CI does not
have at all today.

## Why it is worth doing

Every inflated timeout in this repo exists to absorb `next dev`'s on-demand compilation: `expect`
15s, the starter's 60s, the chromium project's 60s, the destructive project's 120s, `page.goto(…,
{ timeout: 90_000 })`, `test.setTimeout(120_000)`. On CI that cost is roughly 3× local
(`destructive-e2e-reliability.md`: 2.2 min local vs 6.7 min CI for the same 14 tests). A production
build removes the compile entirely, which both shortens the run and lets those budgets shrink — so a
genuine hang surfaces fast instead of sitting inside a 120s allowance.

It would also close a real gap: **CI never runs `pnpm build`.** Only `build:demo-static` (vite) runs
today, so a change that breaks the Next production build passes CI.

## What was measured (2026-07-31, `fix/e2e-port-isolation`)

The obvious cheap route is the existing `build:demo` + `start:demo` pair, which already produce a
fake-adapter production build. **Tried, and it does not work as-is:**

- `pnpm --filter showcase build:demo` succeeds and is fast — compiled in **9.0s**, 67 static pages.
- Serving it with `start:demo` and pointing the existing chromium project at it fails: the run got
  ~41 of 56 tests in with repeated `a11y.spec.ts` failures on `/en` and `/es`
  (`expect(received).toEqual(expected)` on the axe sweep).

The cause is structural, not incidental. `packages/keel/src/adapters/index.ts:61` **fails closed** —
a production build with fake adapters throws unless `DEMO_MODE=1` — and `DEMO_MODE=1` is not
behaviour-neutral: `isDemoMode` renders `<DemoBadge />` in each app's layout
(`apps/showcase/src/app/[locale]/layout.tsx:67`), which changes the very pages the axe sweep asserts on.

So the two candidate routes invert from what you would guess:

1. ~~Reuse `build:demo`/`start:demo`~~ — rejected by the above. The demo badge is part of the demo
   build's contract; e2e should not be asserting around it.
2. **Add an explicit e2e opt-in to the guard** — the required path, not the fallback. One clause on
   the `adapters/index.ts:61` condition (e.g. `&& !isE2eBuild`) yields a production build that is
   byte-for-byte the real thing apart from the adapters. This _preserves_ the guard's intent, which is
   "never serve fake auth in production **by accident**" — an explicit env var is not an accident —
   but it does add a second bypass string, so it wants a test asserting no deployed param set ever
   carries it (`infra/stack.ts` is where that would be checked).

## Shape of the change

- Guard clause in `packages/keel/src/adapters/index.ts` + a unit test that the guard still throws
  without any opt-in.
- `webServer.command` in `apps/*/playwright.config.ts` branches on an env flag (e.g. `E2E_BUILD=1`):
  `next build && next start --port <derived>` instead of `pnpm dev`. Note `next.config.ts` sets
  `output: 'standalone'`, so `next start` does not serve it — either drop standalone for this path or
  reuse `scripts/serve-standalone.mjs`.
- **CI sets the flag; local does not.** Locally `reuseExistingServer` gives a warm dev server across
  runs and a build per attempt would be a net loss. CI is cold every time and pays 3× for compiles,
  which is exactly where the trade pays.
- Once it lands, revisit the timeouts — they were sized for dev-mode compiles and should come down.

## Not a substitute for

`e2e-shared-world-blocks-parallelism.md`. A production build makes each test faster; it does nothing
about specs sharing one `.data`, which is what pins `workers: 1`. The two are independent.
