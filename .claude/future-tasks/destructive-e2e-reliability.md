# Destructive e2e suite: residual CI flakiness

**Priority:** P1 · **Status:** open, but **its central premise has been obsoleted twice** — read
"What CI changed under this file" before pulling any lead below.

Three real causes were found and fixed during the template-adoption campaign, and the suite was still not
fully reliable on CI runners. It is green on a laptop every time.

The project is **14 tests in 9 files** (`playwright test --project=destructive --no-deps --list`).

## Fixed already (do not re-derive these)

1. **The nine destructive specs raced each other.** `dependencies: ['chromium']` orders the two
   _projects_; it does nothing within a project, and `mode: 'serial'` only orders the file it is in.
   All of them mutate the same `.data` world. `pnpm test:e2e` now runs two passes with the destructive one
   pinned to `--workers=1 --no-deps`.
2. **That fix made the destructive pass start against a COLD dev server** (CI sets
   `reuseExistingServer: false`, so the second invocation gets its own server). Every route paid a full
   Next dev compile on first hit and the default 30s timeout was marginal. The project now sets
   `timeout: 120_000` (raised again from 60s on the CI-is-3x measurement recorded below).
3. **`switchPerson` assumed where a switch lands.** Simulator restores each person's last path, and
   `notifications.spec.ts` navigates Ada to `/en/profile` mid-test, so switching back legitimately landed
   on profile while the helper waited for `dashboard|org`. It now accepts any protected route.

## The agreement-gate hypothesis — TESTED AND DISPROVEN (2026-07-31)

I suspected that `--workers=1` made file order alphabetical, putting `access-gates.spec.ts` (which bumps
an agreement version and re-arms a **blocking** interstitial for the whole tenant) ahead of
`notifications.spec.ts`, leaving a person gated so a later `nav-dashboard` click never reaches
`/dashboard`. It fit every symptom. **It is wrong**, or at least not reproducible:

| Experiment (local, pinned Node, cold `.data`)                              | Result              |
| -------------------------------------------------------------------------- | ------------------- |
| `notifications.spec.ts` alone                                              | 2 passed, 1.3m      |
| `access-gates.spec.ts` then `notifications.spec.ts`, serial — the CI order | 3 passed, 1.4m      |
| The FULL destructive project, serial, cold — closest local analogue of CI  | **14 passed, 2.2m** |

## What CI changed under this file

**1. The "shared `.data` between the two passes" lead is DEAD ON CI.**
`.github/workflows/checks.yml` no longer runs the two passes in one job. The `e2e` job is a matrix of
three shards — `showcase` (chromium), `showcase-destructive`, `starter` — each `runs-on: ubuntu-latest`,
i.e. **a separate runner with a separate filesystem**. The destructive shard cannot inherit anything the
chromium shard wrote, because it never sees that disk. Whatever remains on CI is not this.

The lead survives only for the LOCAL `pnpm test:e2e` sequence, which still runs both passes back to back
in one checkout against one `.data`. If a local-only flake shows up, start there.

**2. The "CI is 3× slower" measurement no longer describes CI.**
It was taken against `next dev`, where every route pays an on-demand compile on first hit. CI now sets
`E2E_BUILD: '1'` and runs against a production build (`resolved/e2e-against-production-build.md`), which
removes the compile entirely — locally that took this project from 132s to 57s on the same 14 tests.

The 120s project timeout and the other inflated budgets in `apps/showcase/playwright.config.ts` were
sized for the dev-mode compile. `resolved/e2e-against-production-build.md` explicitly asked for them to
be revisited once the build landed, and **nobody did**. That is now the concrete next step: they are
absorbing a cost CI no longer pays, so a genuine hang sits inside a 120s allowance instead of failing
fast — which is the opposite of what a flaky suite needs.

**Do this next:** re-measure the destructive shard's per-test wall clock on CI under `E2E_BUILD=1`, then
bring `timeout`, `expect.timeout`, the 90s `page.goto` budgets and the 120s `test.setTimeout` down to
something proportionate to it. Only then is a residual failure evidence of a logic bug rather than of a
budget nobody re-derived.

## What remains

One CI run failed four tests across four unrelated spec files (`access-gates`, `actors`,
`simulator-webhooks`, `notifications`) and passed on rerun with no code change. The same commit content,
plus a large additional change, passed on a sibling PR — so it was not the change under review. That run
predates both changes above; whether the failure class survives them has not been checked.

Leads still worth pulling, roughly in order of promise:

- **The timeouts, per the section above.** Cheapest, and it changes what every other lead's evidence
  looks like — do it first.
- **`beforeAll(clearResidue)` vs a serial file.** It wipes `.data/{sms,emails,simulator}` — including
  Simulator continuity — while pglite rows (prefs, agreements, notifications) survive. That asymmetry
  means "reset" means different things to different subsystems. Unaffected by the shard split: the nine
  destructive specs still share one world with EACH OTHER, which is why the shard still runs
  `--workers=1`.
- **Time.** Several specs move the world clock; a spec that leaves the clock advanced changes what "due"
  means for a later one. Also unaffected by the shard split, for the same reason.
- Consider a per-spec world (see `per-visitor-demo-worlds.md` and
  `e2e-shared-world-blocks-parallelism.md` — the same `dataDir()` seam would let each spec file own an
  isolated `.data`, which would kill this class of problem outright rather than serializing around it).

## Why it is P1

The gate is the repo's central quality claim. A suite that fails for reasons unrelated to the change
under review teaches everyone to re-run rather than read, and that habit is how a real regression ships.
