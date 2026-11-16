# Nothing maps a local command to the CI job that runs it

**Priority:** P2 · **Status:** open
**Found by:** an app derived from this template, 2026-10-03. Five times in two days, a session treated
a local `pnpm verify` green as a CI green and then went red on a check `verify` never runs.
Re-checked here against CLAUDE.md and `.github/workflows/checks.yml`.

## The gap

CLAUDE.md's Workflow section says `pnpm verify` does NOT run `test:contract`, jscpd, coverage, or
gitleaks, and that CI runs those. That is true, but it does not say **which CI job** runs each one,
and the list is incomplete. A session that wants to know whether its local green covers what the PR
will be judged on has to read `checks.yml` itself. The sessions that went red had not.

What `checks.yml` actually runs, compared with `verify`:

| Check                                                | Local command                                                            | In `pnpm verify`?       | CI job                                                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Lint (ESLint + Prettier check)                       | `pnpm lint`                                                              | yes                     | `lint-typecheck-unit`                                                                                                         |
| Typecheck (every app + root)                         | `pnpm typecheck`                                                         | yes                     | `lint-typecheck-unit`                                                                                                         |
| Unit tests                                           | `pnpm test:unit`                                                         | yes                     | `lint-typecheck-unit`, as `pnpm test:coverage`                                                                                |
| Coverage report                                      | `pnpm test:coverage`                                                     | **no**                  | `lint-typecheck-unit`                                                                                                         |
| Dead code                                            | `pnpm knip`                                                              | yes                     | `lint-typecheck-unit`                                                                                                         |
| Duplication                                          | `pnpm jscpd`                                                             | **no**                  | `lint-typecheck-unit`                                                                                                         |
| Infra synth                                          | `pnpm --filter infra synth`                                              | **no**                  | `lint-typecheck-unit`                                                                                                         |
| Kysely/pglite spike                                  | `pnpm --filter spike-kysely-pglite test`                                 | **no**                  | `lint-typecheck-unit`                                                                                                         |
| RLS proofs on real Postgres                          | `pnpm test:contract`                                                     | **no**                  | `contract`                                                                                                                    |
| E2E, per app                                         | `pnpm test:e2e`                                                          | yes, against `next dev` | `e2e` matrix (one shard per app, two for an app with a `destructive` project), **against a production build** (`E2E_BUILD=1`) |
| Static demo build + size budget + e2e                | `pnpm build:demo-static && pnpm check:demo-size && pnpm e2e:demo-static` | yes                     | `demo-static`                                                                                                                 |
| Adoption (`init-app --eject-showcase` then `verify`) | see the job's steps                                                      | **no**                  | `adoption-probe`                                                                                                              |
| Secret scan                                          | `gitleaks git` (binary not installed locally)                            | **no**                  | `secret-scan`                                                                                                                 |

There are two things here that CLAUDE.md's sentence does not cover. It leaves out three more checks
that `verify` also skips: infra synth, the spike, and the adoption probe. And e2e runs locally against `next dev` but in CI against a production
build, so "e2e passed locally" does not cover `next build`. That gap has already bitten the starter,
in `.claude/future-tasks/starter-e2e-ignores-e2e-build.md`.

## Shape of the change

- Put this table where it will be read: in CLAUDE.md beside the `pnpm verify` sentence, or in a doc
  that CLAUDE.md links to with one line. Rebuild it from `checks.yml` when doing so; do not copy it
  from here.
- Keep it honest the way this repo keeps its other lists honest: a unit test that reads `checks.yml`
  and fails when a job runs a `pnpm` script the table does not list. Otherwise the table goes stale
  the first time someone adds a CI step, and a stale map is worse than none.
- State the rule the table supports: **a local green is evidence only for the rows marked "yes".**
  Before calling a change done, run the "no" rows the change could affect. CLAUDE.md already requires
  this for `test:contract` on db changes. The table makes the same rule apply to every row.
