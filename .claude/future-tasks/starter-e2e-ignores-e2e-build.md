# The starter's e2e shard is handed `E2E_BUILD=1` and ignores it

**Priority:** P2 · **Status:** open
**Found by:** reconciling `.claude/future-tasks/resolved/e2e-against-production-build.md` against the
code, 2026-07-31. That task resolved the showcase and left the starter behind without saying so.

## The gap

`.github/workflows/checks.yml` sets `E2E_BUILD: '1'` once, on the whole `e2e` job — so it lands in the
environment of all three shards, `showcase`, `showcase-destructive` **and** `starter`. Only the showcase
reads it:

- `apps/showcase/playwright.config.ts` branches `webServer.command` on the flag
  (`pnpm run build:e2e && pnpm run start:e2e` vs `pnpm dev`) and stretches the server timeout to match.
- `apps/starter/playwright.config.ts` hard-codes `command: 'pnpm dev'`. There is no branch to take, and
  `apps/starter/package.json` has no `build:e2e` or `start:e2e` for it to take one to.

So the starter shard still runs `next dev` on CI, pays the on-demand compile the flag exists to remove,
and — the part that matters more — **CI never runs `next build` for the starter at all**. The showcase
closed exactly that hole; the starter still has it, and nothing goes red to say so.

Setting a flag a config does not read is also the failure mode that hides itself: the CI log shows
`E2E_BUILD=1` in the environment and a dev server starting, and the two look consistent unless you know
the config never consults it.

## Why it is worth doing rather than deleting the flag

The starter is the framework's falsifier — it exists so that a keel change which assumes the showcase
fails to build. A production build is a stronger falsifier than `next dev`: `next build` typechecks
routes, runs static generation, and enforces the server/client boundary in ways dev does not. An app
whose whole job is to catch framework assumptions should be the app CI builds.

## Shape of the change

- `apps/starter/package.json` gains `build:e2e` and `start:e2e`, copied from the showcase's pair
  (`E2E_BUILD=1 APP_MODE=simulated next build`, and `scripts/serve-standalone.mjs` for the serve half —
  `next.config.ts` sets `output: 'standalone'`, so plain `next start` does not serve it).
- `apps/starter/playwright.config.ts` takes the showcase's `E2E_BUILD` branch, including the longer
  `webServer.timeout` a build needs before it can serve.
- Watch the duplication gate while doing it: both playwright configs and both script pairs would then
  state the same thing twice, which is the case `route-glue-duplication.md` is about.

**Done when** the `starter` CI shard's log shows a `next build` rather than a dev server, and a
deliberately broken production build (e.g. a client-only import in a server component) fails that shard.

## Observed cost, 2026-08-02 — an adopter's very first `pnpm verify`

Round four of the pre-publication verification hit the symptom on the adopted tree, on the first run
after `pnpm install`: the starter's single e2e spec timed out at 60 s and passed on retry.

```
✘  1 [chromium] › tests/e2e/items.spec.ts:35:5 › an item created in one tenant is invisible from the other (1.0m)
✓  2 [chromium] › ... (retry #1) (6.7s)
   Error: page.waitForURL: Test timeout of 60000ms exceeded.
     waiting for navigation to "**/dashboard"; navigated to "http://localhost:3100/en/signin"
1 flaky
```

`apps/starter/playwright.config.ts` sets `retries: process.env.CI ? 2 : 1`, so the one local retry
absorbed it. **With `retries: 0` an adopter's first-ever `pnpm verify` would have been red** — on a
tree whose only e2e test is that one spec, so the shard is all-or-nothing.

Not reproduced: three further runs, one with `.next` and `.data` both deleted, took 8.7 s / 8.6 s /
11.3 s, all green. So 1 flake in 4, cause unconfirmed — consistent with a cold on-demand compile
racing a 60 s timeout, which is exactly what this task removes, but not proof of it.

Two things follow. First, this is now known to bite the adoption path and not just CI hygiene, which
argues for doing it sooner. Second, if it stays open, consider raising the starter's `timeout` above
60 s as a stopgap so the cold-compile case is not a coin flip on someone's first impression.
