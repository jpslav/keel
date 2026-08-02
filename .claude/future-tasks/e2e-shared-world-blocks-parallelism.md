# E2E parallelism is blocked by one shared world, not by memory

**Priority:** P1 — this is the single biggest remaining e2e speed lever, and it is also the root cause
of an already-recorded CI flake.

**Status:** open, half done. Fix 1 (atomic writes) SHIPPED; fix 2 (a world per worker) is untouched, and
it is the one that unpins `workers`.

## What was believed

`apps/*/playwright.config.ts` pinned `workers: 1` locally with the justification "the dev VM has 10GB
RAM; parallel Chromium renderers get OOM-killed". `docs/build-notes.md:52` says the same. That made
the limit sound like a property of one machine, so the obvious move on a bigger machine was to raise it.

## What is actually true (measured 2026-07-31)

On a 10-core / 64 GB machine — where memory cannot be the binding constraint — the flake count over
the _same 56 chromium tests_ rose monotonically with parallelism:

| workers | wall clock | flaky | note                            |
| ------- | ---------- | ----- | ------------------------------- |
| 1       | 102.0s     | 0     |                                 |
| 2       | 73.0s      | 1     |                                 |
| 3       | 93.7s      | 2     |                                 |
| 4       | 63.1s      | 2     |                                 |
| 5       | 62.7s      | —     | **world corruption**, see below |

The cause is that every worker drives ONE dev server holding ONE `.data`. Specs mutate each other's
state. The repeat offenders are exactly the specs that write shared state: `tenancy.spec.ts` and the
demo-banner flag in `simulator-technical.spec.ts`.

**`tenancy.spec.ts` is the same test `docs/build-notes.md:296` records as a recurring CI flake** — CI
runs Playwright's default worker count, so CI has been running in the flaky regime all along, with
`retries: 2` masking it.

At 5 workers it degraded past "specs disturb each other" into outright corruption:

```
SyntaxError: Unexpected non-whitespace character after JSON at position 751
```

Every fake adapter persisted its state with a plain `writeFileSync`/`writeFile`, which TRUNCATES and
then streams the new bytes in. Two concurrent writers both truncate, the longer write lands, the
shorter overwrites its prefix, and the tail of the longer one survives past the end of valid JSON —
position 751 in an 821-byte `invites.json`.

## Fix 1 — atomic writes in the fake adapters: SHIPPED

`packages/keel/src/adapters/fake/atomic-write.ts` is that fix. It writes to a temp file colocated with
the target (same directory ⇒ same filesystem ⇒ `rename()` is genuinely atomic rather than silently
degrading to copy+delete) and publishes with a rename, so a concurrent reader of the target always sees
either the whole old file or the whole new file. Four helpers — `writeFileAtomicSync`,
`writeFileAtomic`, `writeJsonAtomicSync`, `writeJsonAtomic` — cover the sync and async, raw and JSON
cases; `packages/keel/src/adapters/fake/atomic-write.test.ts` covers it in 8 tests. It is deliberately
internal: not in `packages/keel/package.json`'s `exports`, reached by relative import like any other
module-private file in that directory.

**There are now zero plain `writeFileSync`/`writeFile` calls left in `packages/keel/src/adapters/fake/`
production code** — the only survivors are inside `atomic-write.ts` itself, which is the implementation.
20 call sites across 10 adapters (`analytics`, `auth`, `clock`, `email`, `service-auth`,
`simulator`, `simulator-admin`, `sms`, `storage`, `webhooks`) go through the helpers. The three sites
this file used to name as needing the fix — `analytics.ts`, `clock.ts`, `webhooks.ts` — all call
`writeJsonAtomicSync` today.

**What it bought, and what it did not.** It removes CORRUPTION: no reader can observe a spliced file
again, so the position-751 class is gone. It does NOT remove **lost updates** — two concurrent
read-modify-write cycles on the same file still race to last-write-wins, because the second rename
simply clobbers the first's content. The module's own docblock says this plainly, and it is why fix 1
was always necessary-but-not-sufficient. Raising `workers` on the strength of fix 1 alone would trade a
loud failure (invalid JSON) for a silent one (a write that vanished), which is worse.

## Fix 2 — a world per worker: STILL OPEN, and this is the one that unpins `workers`

`packages/keel/src/adapters/fake/data-dir.ts` already reads `APP_DATA_DIR`, which is the seam — but it
reads it from `process.env` on every call, so it is a single process-global: one value for the whole
server, not one per in-flight request. All workers share one dev server, so isolating them means either

- making the data dir **request-scoped** (a header the Playwright fixture sets, resolved through
  AsyncLocalStorage rather than `process.env`), or
- giving each worker **its own server** — which is what `local-parallel-e2e.md` builds, and its
  preferred route (shard against the production build, one `serve-standalone` process per shard with
  its own `APP_DATA_DIR`) is now unblocked.

See also `per-visitor-demo-worlds.md`, which wants the same primitive for a different reason.

`workers: 1` stays in both `apps/*/playwright.config.ts` until this lands.

## Until then

Parallelism is bought where the worlds are genuinely separate: across apps locally (different ports
via `scripts/ports.mjs`, different cwd-relative `.data`) and across shards on CI (different machines —
`.github/workflows/checks.yml` splits the suite across three runners). Never inside one server.

Note also that raising `workers` surfaced a second, independent problem that IS fixed: the chromium
project was the only one still on Playwright's 30s default test timeout, and now uses 60s like the
starter's. That one was a genuine budget bug, not a race.

## Reproduce

```bash
cd apps/showcase && rm -rf .data
node ../../scripts/e2e-profile.mjs --project=chromium --workers=5
```

The corruption half of what this used to show is now closed by construction — an atomic rename cannot
publish a spliced file — so what a re-run measures is fix 2's territory: specs mutating each other's
world, and read-modify-write cycles losing updates. Re-measure before quoting new flake counts; the
table above predates fix 1.
