# keel's own test suite is welded to consumer #1

**Priority:** P1 · **Status:** RESOLVED 2026-07-31 — `packages/keel/test-fixture`
**Found by:** `apps/starter` (consumer #2), 2026-07-31. Recorded in ADR-0012.
**Re-measured:** 2026-07-31, by the two commands in "How to re-measure" below. Do that again before
implementing from this file — the numbers move whenever a test is added.

The framework no longer assumes the showcase — its _tests_ still do. They reference the demo app's
vocabulary as **string literals**, not imports: no keel test imports `@app/seed`, so the weld is
invisible to the lint fence and to the compiler, and only shows up when the seeded world changes
underneath them.

## Resolution — keel got a fixture app of its own

Implemented as the "fixture app" option below. `packages/keel/test-fixture/` is a conforming
17-module `@app-config/*` seam owned by the framework: its own seed world, one table (`dockets`) and
migration, an app-shaped job kind, webhook kind, notification kind and audit verb, a `support`
inbound handler, its own catalog and LLM fixture, and a route tree. It sits **outside**
`packages/keel/src` so the lint fence, jscpd, knip and the root tsconfig all keep treating that
directory as framework code.

Its vocabulary (`harbor`/`lakeside`, `depot`/`annex`/`steward`/`wharf`, `fixture-*`, `dockets`) is
deliberately neither app's, so a regression back to app coupling is obvious rather than silent.

`vitest.config.ts` lost `FRAMEWORK_SUITE_APP`; keel's suite now runs under its own project, aliased
at the fixture. The ROOT `tsconfig.json` resolves `@app-config/*` there, which is what cleared the
root program's type errors. `authorized-mutations.test.ts` gained a second, package-relative scan
root so the authorize() gate survives ejection instead of being weakened.

**Definition of done, met:** `pnpm init-app acme --eject-showcase --yes && pnpm install && pnpm verify`
is green end to end in a probe copy outside `/tmp`.

Three things the work turned up that the analysis below missed:

- `scripts/llm-record.ts` was a hidden root-program dependency on the showcase — `exclude` does not
  stop a file being pulled in by an import. It moved to `apps/showcase/scripts/`.
- `simulator.stories.tsx` hard-coded an app's `ActorId`; only the root program ever typechecked it.
- The CSV escaping tests (RFC-4180 quoting, formula-injection neutralization) were riding inside
  keel's fake-jobs suite and would have been deleted with it. They now live beside the handler they
  cover, in `apps/showcase/src/jobs/export-tickets.test.ts`.

The analysis below is kept for its measurements and for the four dependency categories, which are
what the fixture had to satisfy.

## The measurement (as it stood when this was open)

keel's suite is **39 test files / 383 tests** (`packages/keel/src/**/*.test.ts(x)`). Run under the
STARTER's aliases instead of the showcase's, **10 files and 48 tests fail**:

| File                                                    | Failing | Needs                                                        |
| ------------------------------------------------------- | ------- | ------------------------------------------------------------ |
| `packages/keel/src/db/jobs.test.ts`                     | 11      | seed org slugs + an app job kind (`export-tickets`)          |
| `packages/keel/src/adapters/fake/jobs.test.ts`          | 8       | the `tickets` table, `export-tickets`, seed org slugs        |
| `packages/keel/src/db/schedules.test.ts`                | 5       | seed org slugs + an app job kind                             |
| `packages/keel/src/adapters/fake/auth.test.ts`          | 4       | person ids + seed org slugs                                  |
| `packages/keel/src/adapters/fake/service-auth.test.ts`  | 4       | org slugs, incl. the same slug in two tenants                |
| `packages/keel/src/inbound-email/intake.test.ts`        | 4       | the `tickets` table + a registered `support` inbound handler |
| `packages/keel/src/server-lib/notify.test.ts`           | 4       | a NON-internal app job kind + seed org slugs                 |
| `packages/keel/src/adapters/fake/fake-adapters.test.ts` | 3       | tenant slugs + the app-owned LLM fixture directory           |
| `packages/keel/src/db/webhooks.test.ts`                 | 3       | seed org slugs + an app event kind (`escalation.created`)    |
| `packages/keel/src/db/audit.test.ts`                    | 2       | seed org slugs                                               |

Two files that used to be on this list are no longer on it, and the reasons are worth knowing:

- `packages/keel/src/service-auth/verify.test.ts` passes, because it resolves the TENANT slug
  `northwind` and **both apps happen to seed a tenant with that slug** (`packages/seed/src/index.ts`
  and `apps/starter/src/seed/index.ts`). That is a coincidence of two seed files, not a de-weld — it
  will break the moment either app renames its tenant.
- `packages/keel/src/authz/authorized-mutations.test.ts` passes here because the alias swap does not
  remove the showcase's ROUTE TREE — that test walks `apps/*/src/app/api` from the repo root. It fails
  only in a repo the showcase has actually been ejected from.

**The weld is not only at runtime.** Compiling `packages/keel/src/**` — tests and stories included —
against the starter's seam gives **25 errors in 5 files**:

| File                                                           | Errors | Why                                                                                    |
| -------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| `packages/keel/src/inbound-email/intake.test.ts`               | 16     | `tickets` is not in the starter's `DB` type, so the whole query builder chain degrades |
| `packages/keel/src/adapters/fake/jobs.test.ts`                 | 3      | `tickets` as a table name and its column shape                                         |
| `packages/keel/src/db/webhooks.test.ts`                        | 3      | `escalation.created` is not in the starter's event-kind union                          |
| `packages/keel/src/server-lib/notify.test.ts`                  | 2      | app job kind                                                                           |
| `packages/keel/src/components/simulator/simulator.stories.tsx` | 1      | a showcase actor id                                                                    |

The same compile against the SHOWCASE's seam is clean — 0 errors — which is the control that makes the
25 mean something. Each app's own `typecheck` also passes, because the app tsconfigs exclude keel's
tests; it is the ROOT program (`tsconfig.json`, which includes `packages/keel/src/**`) that breaks. A
fixture world therefore has to satisfy the compiler as well as the runtime.

## How to re-measure

Both probes are throwaway configs that point `@app-config` at the starter and run/compile only
`packages/keel/src`:

- **Runtime:** copy `vitest.config.ts`'s `projectFor('starter')` but give it the framework-suite
  include (`packages/keel/src/**/*.test.{ts,tsx}`) instead of the seam-conformance subset, and
  `vitest run --config` it.
- **Compile:** a `tsconfig` extending the root one with `paths` repointed to `apps/starter/src/*` and
  `apps/starter/src/app-config/*`, `include` set to `packages/keel/src/**`, and `exclude` emptied.
  Run the same probe with the showcase paths as a control; it must come back clean.

Denominators come from `find packages/keel/src -name '*.test.ts*' | wc -l` and the suite's own summary.

## The four dependencies, in rising order of cost

1. **Seed slugs** — the failing files resolve a tenant + org from the seeded DB by slug through a local
   `ids(...)` helper. The live calls are `ids('northwind', 'frontline')` (16 sites) and
   `ids('northwind', 'platform')` (3 sites). Cheapest to de-weld, but not free: `service-auth.test.ts`
   deliberately needs the SAME org slug in two different tenants, which is a property of the showcase's
   seed, not an accident of it.
2. **An app job kind.** `notify.test.ts` distinguishes internal kinds (no-op) from app kinds (notify),
   so `digest-email` cannot stand in for `export-tickets` — the test needs one of each.
3. **An app table, handler, event kind and fixture.** `tickets` (inserted into, and exported to CSV by
   the job handler), a registered `support` inbound-email handler, the `escalation.created` webhook event kind,
   and `apps/showcase/fixtures/llm/` for the fake LLM replay.
4. **An app route tree.** `authorized-mutations.test.ts` asserts that the walk finds `tickets/route.ts`,
   `jobs/route.ts` and `org/invite/route.ts`, and that every entry in its exemption map still maps to a
   real mutating route. Both are guards against a silently-broken scan, and both name consumer #1.

## Consequence

keel's suite runs once, under the `showcase` vitest project (`FRAMEWORK_SUITE_APP` in
`vitest.config.ts`). Only the genuinely app-agnostic tests — the i18n partition/parity pair, the
composed pglite RLS suite — run under both apps.

**`pnpm init-app --eject-showcase` therefore leaves `pnpm test:unit` and `pnpm typecheck` red**, and
says so on the way out rather than skipping or deleting the tests. `docs/adopting.md` tells adopters the honest sequencing:
eject last. This is the same class of defect the RLS proof split already fixed once, and the same
lesson: _anything the template tells an adopter to delete must not be load-bearing for anything it
tells them to keep._

## Approach

Give keel a **fixture app of its own** — a seam implementation under the package (its own
`@app-config/*` target, its own seed world, one throwaway table it owns, one app-shaped job kind, one
app-shaped event kind, one inbound handler, one LLM fixture) and a vitest project aliased to it. Then
keel's suite runs against a world the framework controls and both real apps become irrelevant to it.

The alternative — deriving "first tenant / first org" from whatever world is seeded — fixes the slug
category (roughly half the failures) but cannot fix categories 2, 3 and 4, and weakens the tests that
deliberately assert on a specific multi-tenant shape. `packages/keel/src/db/rls-proofs.ts` is the worked
precedent for the fixture approach: copy its shape rather than re-deriving it.

Watch the duplication gate while doing it: the fixture must not become a second copy of the showcase's
seed sitting inside `packages/keel/src`, which `jscpd` scans.

**Definition of done:** `pnpm test:unit` AND `pnpm typecheck` pass with `apps/showcase` deleted from
the workspace — i.e. `pnpm init-app <slug> --eject-showcase && pnpm install && pnpm verify` is green
end to end. Everything else in the gate already is: lint, knip, jscpd, the doc-path gate, e2e, the
static-demo build, its size budget and its `file://` walkthrough all pass on a freshly ejected repo.
