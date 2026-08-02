# Local parallel e2e: shard with a server AND a world each

**Priority:** P2 — CI already parallelises (job matrix); this is the local `pnpm verify` loop, still
~230s serial for the showcase.

**Status: unblocked, unbuilt.** When this was written, route 2 below depended on a production-build path
that did not exist. It exists now: `E2E_BUILD` is read by `apps/showcase/playwright.config.ts` and by
`packages/keel/src/adapters/index.ts`, and `apps/showcase/package.json` carries both `build:e2e` and
`start:e2e` (`.claude/future-tasks/resolved/e2e-against-production-build.md`). Nothing blocks the
preferred route any more — only the shard runner itself is missing.

Two things to know before starting:

- **`scripts/serve-standalone.mjs` already carries a forward reference to a runner that does not
  exist.** Its `APP_DATA_DIR` comment ends "…which is how the shard runner gives each shard its own",
  and there is no shard runner in `scripts/` — `scripts/e2e-shards.mjs` was reverted, not shipped. The
  serve half is genuinely ready; the sentence describing its caller is aspirational. Whoever builds this
  should make that sentence true rather than delete it.
- **The starter cannot be sharded this way yet.** It has no `build:e2e`/`start:e2e` and its playwright
  config never reads `E2E_BUILD` — see `.claude/future-tasks/starter-e2e-ignores-e2e-build.md`. Shard
  the showcase first; the starter's suite is one spec anyway, so it is not where the local time goes.

## The idea, and why it is the right one

Playwright's `workers` cannot be raised: every worker shares one dev server and one `.data`, so specs
mutate each other (`e2e-shared-world-blocks-parallelism.md`). But parallelism is safe when the WORLDS
are separate — that is exactly why CI's job matrix works. The local equivalent is to shard into N
processes, each with:

- its own port (`scripts/ports.mjs`), and
- its own world via `APP_DATA_DIR` (the override `adapters/fake/data-dir.ts` already reads).

It also dissolves an ordering constraint: the destructive project only runs after chromium
(`dependencies: ['chromium']`) because they share a world. Given a world each they are independent,
and since destructive is the longer pass, running the two concurrently is most of the win on its own.

## Attempted 2026-07-31, and the wall it hit

Built exactly that (`scripts/e2e-shards.mjs`, 3 shards per project, own port + own `APP_DATA_DIR`
each). 5 of 6 shards died immediately:

```
⨯ Another next dev server is already running.
  - Local:  http://localhost:3761
  - PID:    49554
  - Dir:    …/apps/showcase
```

**Next 16 refuses to run a second `next dev` for the same project directory, whatever port you give
it.** The lock is per-DIRECTORY, not per-port — it lives under `.next/dev/`. Distinct ports and
distinct data dirs are not enough, because all shards share one `.next`.

The attempt was reverted rather than shipped; this file is what it produced.

## The two ways past it

1. **Per-shard `distDir`.** `next.config.ts` would read e.g. `process.env.NEXT_DIST_DIR ?? '.next'`,
   and each shard would get its own. That separates the lock along with the build output. Cheapest
   change, but it puts a test-only concern into app config, and each shard then pays its own cold
   compile — which may eat the gain, since compile is most of dev-mode e2e cost.
2. **Shard against the PRODUCTION build instead (preferred).** `E2E_BUILD=1` now exists and is
   proven: build once, then run N `serve-standalone` processes on N ports with N `APP_DATA_DIR`s.
   `scripts/serve-standalone.mjs` spawns a plain `node server.js` with no dev lock at all, so the
   blocker simply does not apply. And the build is shared, so the compile is paid once for all shards
   rather than N times.

    Measured on the way to this note: the production build makes the destructive project **57s vs
    132s** and chromium **56 passed clean**. So route 2 compounds two wins instead of trading them.

    Shape: `scripts/e2e-shards.mjs` (to be written — the earlier attempt was reverted, so nothing of it
    is in the tree) runs `pnpm build:e2e` once, then spawns N Playwright invocations whose
    `webServer.command` is `start:e2e` only (no build), each with `SHOWCASE_PORT` and `APP_DATA_DIR`
    set. The reverted script is otherwise reusable as-is, but the branch that
    prototyped it is not part of the published history — rebuild it from the shape above.

## Watch out for

- `scripts/serve-standalone.mjs` pins `APP_DATA_DIR` to the app's `.data` when the caller does not set
  one. A shard runner MUST set it, or every shard shares one world and the whole exercise is pointless.
- Port band: reserve one, disjoint from the app band (3200–3599) and contract Postgres (5440+), and
  index it by checkout slot so two worktrees sharding at once still cannot collide.
