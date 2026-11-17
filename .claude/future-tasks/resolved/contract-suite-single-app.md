# The contract suite only ever runs one app's migrations

**Priority:** P2 · **Status:** RESOLVED 2026-11-17 (ADR-0014, step P11)
**Found by:** `apps/starter`, 2026-07-31. Recorded in ADR-0012's Consequences.

`pnpm test:contract` — the anti-drift run that proves the RLS proofs hold on real Postgres, not just
pglite — covers `apps/showcase` only.

Two apps share framework migrations 0001–0999 but diverge from 1001, so running the second app's
`migrateToLatest` over the first app's database makes Kysely report corrupted migrations. A second
contract run needs a **second database**, not just a second alias set.

**Why it matters:** the contract suite is the repo's proof that the fakes have not drifted from the real
engine. An app whose migrations never meet real Postgres has that proof only on pglite — and per-app
migrations are exactly where an adopter's own tables live, so the untested half is the half they write.

**Approach:** parameterize `vitest.contract.config.ts` over apps with a distinct database name per app
(the local runner uses embedded-postgres, CI a service container — both can host two databases). Then
fan out like the other per-app scripts.

**Update 2026-10-03:** half of this pattern now exists. keel's fixture seam has a second project in
`vitest.contract.config.ts` and its own database (`packages/keel/src/adapters/real/db.contract.test.ts`
creates `keel_contract` on the same server, embedded or CI's). A second APP would follow the same
shape: add a project with that app's aliases, and give its harness a database name of its own. The two
harnesses still duplicate the embedded-postgres boilerplate. If a third arrives, extract the shared
part first.

## Resolution

`pnpm test:contract` runs **every app's** suite, each in a database of its own, plus keel's fixture. The pieces:

- **One generic suite, extracted as the note above asked once a third harness arrived.** `tests/support/contract-postgres.ts`
  owns "an embedded-postgres, or CI's service container (`CONTRACT_DATABASE_URL`), and a database of this suite's own on it"
  (`startContractServer`, `createDatabase`, `contractDatabaseName(slug)`, which folds the slug to `<slug>_contract`);
  `tests/support/contract-suite.ts` is `defineContractSuite({ database })`: a non-superuser owner migrates and runs the proofs
  (`keel/db/owner-pass`, now published so a suite outside keel can call it), the same again where `app_user` already exists,
  and the full proof suite as a superuser. An app's contract test is four lines of code. keel's two fixture harnesses
  (`db.contract.test.ts`, `rds-data.contract.test.ts`) use the same server helper instead of their own copies.
- **Discovered, not named.** `vitest.contract.config.ts` makes one project per `apps/*` that has a `tests/contract`
  (`tests/support/contract-apps.ts`), so it no longer carries a `CONTRACT_APP` literal and `init-app` rewrites nothing in it.
  `tests/tooling/app-scaffold.test.ts` is what stops an app from quietly not having one: an app that registers migrations and has no
  `defineContractSuite` is a finding.
- **The starter has its own suite and its own `config/params.ts`**, so `init-app --eject-showcase` has nothing to rescue from the
  showcase: its rescue step (the harness, `params.ts`, three devDependencies) and the contract-config rewrites are gone, 66 lines
  fewer. The same test checks that every app's params have one shape (infra reads the same keys whichever app it is pointed
  at) and cite cutover rows that exist.
- **Measured.** Before: 3 files, 37 tests, ~12 s. After: 4 files (showcase, starter, keel's two), 42 tests, ~10 s, on one embedded
  server per file; and against one shared server, as CI runs it, all four pass in one run with each suite in its own database.

**What the owner pass found:** nothing new in either app: both apps' own migrations migrate and switch roles under a non-superuser
owner, which is what #53's pass proves for the framework's. It now runs for each of them.
