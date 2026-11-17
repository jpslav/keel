# ADR-0004 — Tenancy: tenant_id everywhere + Postgres row-level security

- Status: Accepted
- Approver: JP Slavinsky
- Date: 2026-08-01

## Context

Multi-tenancy has to be shaped in from the first migration — retrofitting it means auditing every query
ever written — and enforcement should live in the database rather than in query discipline, because
query discipline is a promise and a policy is a mechanism.

One local constraint shaped the mechanism: pglite (ADR-0002) connects as a bootstrap superuser, which
bypasses row-level security entirely. `FORCE ROW LEVEL SECURITY` does not override `BYPASSRLS`. So the
enforcement design must work in the in-process database too, or the tests that prove isolation prove
nothing.

## Decision

**Every tenant-scoped table carries `tenant_id`, and isolation is a Postgres policy.**

Policies use `ENABLE` + `FORCE ROW LEVEL SECURITY` with both `USING` and `WITH CHECK` on:

```sql
tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
```

Unset context yields NULL — or an empty string once the session has ever `SET LOCAL` a custom GUC, which
is why the `NULLIF` is there (ADR-0002) — so it means zero rows, fail-closed, never an error.

**All tenant-scoped access goes through `runWithTenant`** (`packages/keel/src/db/with-tenant.ts`, exposed
as `db.withTenant()`), which opens a transaction and, inside it:

1. `SET LOCAL ROLE app_user` — static SQL, because `SET` takes no bind parameters. This drops the
   superuser bypass under pglite, which is what makes the local proofs meaningful.
2. `SELECT set_config('app.current_tenant', $1, true)` — parameterized, because interpolating a tenant id
   into SQL is an injection risk sitting directly on the isolation boundary.

Transaction-scoped context is also the only shape that is safe under connection pooling. A lint rule
bans reaching for the raw client (`getDb`) in request paths, so the wrapper cannot be quietly skipped.

`app_user` is granted the narrowest privileges each table needs, and that is part of the design rather
than tidiness: `service_keys` grants `SELECT` only (request paths verify against those rows, never write
them), and `audit_events` grants `SELECT, INSERT` only, so the audit log is append-only at the privilege
layer and not merely by convention.

**Every app seeds at least two tenants**, so cross-tenant isolation is exercised by simply using the app
rather than only by tests.

### Organizations ("teams") are an app-level filter, not a second RLS GUC

Organizations group users within one tenant (ADR-0003). Team-scoped tables carry a nullable `org_id` and
the app filters by the active org (`where org_id = :active`) **inside the existing `withTenant`
transaction**. RLS stays tenant-only.

The reasoning is about what each boundary promises. A team is a _collaboration_ boundary among
mutually-trusting users of one customer: shared admins, memberships that are user-visible and managed
through the auth port, which already enforces membership (`setActiveOrg` throws on non-membership, so
`user.orgSlug` is always a real membership). The tenant is the _hostile-isolation_ boundary — its own
site, its own auth instance, its own RLS scope. Encoding teams as a second RLS GUC would claim an
isolation property the product does not promise, and would tax every future team table with a second
`set_config`, policy rewrites and doubled proof cases. It is recorded as available future hardening, not
as slice work.

`org_id` is nullable so the proof suite and pre-existing rows stay valid; the app filter simply excludes
NULL. `organizations` is RLS-free infrastructure, like `tenants`.

### Three shapes of table, and the reference for each

| Shape               | Reference migration                                              | Scoping                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Team-scoped content | `apps/showcase/src/app-config/db/migrations/1001_tickets.ts`     | tenant RLS + `where org_id = :active`                                                                                                            |
| Two-sided content   | `apps/showcase/src/app-config/db/migrations/1002_escalations.ts` | tenant RLS + `where (requester_org_id = X OR responder_org_id = X)` — still one app-level filter in the same transaction, still no second policy |
| Tenant-wide content | `packages/keel/src/db/migrations/0013_agreements.ts`             | tenant RLS alone; no `org_id` column at all                                                                                                      |

The third row is worth naming because it is the case people over-engineer. A site's terms of service
applies to every team in the tenant uniformly, so `agreements` has no `org_id` — not nullable, not
present — and the base decision above is its entire isolation story.

### The proof suite is composed, and runs on both engines

`packages/keel/src/db/rls-proofs.ts` proves the framework tables (jobs, service_keys, audit_events,
job_schedules, webhooks, notifications, inbound_emails, agreements) using only framework vocabulary. It
has **zero seam imports**, so "keel proves its own tenancy with no app present" is true at the file level
rather than by argument. Each app registers its own half at `@app-config/db/rls-proofs`, conforming to a
framework-exported contract type like every other seam module.
`packages/keel/src/db/rls-proof-runner.ts` composes framework ∪ app and is the single entry both engines
call — pglite in unit tests, real Postgres in `pnpm test:contract` — so the anti-drift property holds:
the identical assertions run on both.

Two of those assertions are the ones that make the rest mean anything, and they live on a **framework**
table deliberately, so keel's standalone proof is not vacuous either:

- a **superuser negative control** — a privileged connection without `SET LOCAL ROLE` sees rows, which
  proves the isolation assertions are not passing for the wrong reason;
- a **fail-closed check** — role set, tenant context unset, zero rows and no error.

## Consequences

- Isolation is proven by tests that run unfiltered queries under RLS, including the negative control and
  a cross-tenant INSERT rejected by `WITH CHECK`.
- Every tenant-scoped query pays a transaction wrapper. That is accepted: it keeps the context explicit
  and there is nowhere else the `SET LOCAL` could go.
- RLS SQL is hand-written in migrations. That is write-once work and would be true under any ORM.
- Deleting the demo app cannot break the framework's tenancy proof, because the framework's half names no
  app table.
- The proofs run twice on every change (pglite and, in CI, real Postgres), which is the price of trusting
  an in-process database to stand in for the real one.

## Addendum — 2026-11-16: the two-seeded-tenants rule is keel's own, not every adopter's

The Decision says "Every app seeds at least two tenants, so cross-tenant isolation is exercised by simply
using the app rather than only by tests." That is a rule about the apps this repo ships, and it reads as
binding on every app built on it. An app deployed **one tenant per deployment** (each instance serves one
customer) has no second tenant to seed and no reason to invent one.

**What changes.** keel's own apps (`apps/showcase`, `apps/starter`) and any adopter that runs more than one
tenant in a deployment keep seeding at least two. An app deployed one tenant per deployment **may seed one**,
provided its half of the proof suite, registered at `@app-config/db/rls-proofs`, still exercises two tenants:
every tenant-scoped table of its own proven against the other tenant's rows, as the framework's half and the
starter's do (unfiltered reads both ways, `WITH CHECK` on a cross-tenant write). The rest of the Decision is
untouched, including `tenant_id` on every tenant-scoped table and the policies on all of them.

**Why that is safe.** Nothing in the framework reads the seed's tenant count. Checked on 2026-11-16: the
Simulator's People tab shows its tenant chip only when the rows differ in tenant
(`keel/components/simulator/people-dimensions.ts`, written for apps that "only ever run one tenant");
the theme and the static demo's world fall back to the first seeded tenant, which needs one and not two
(`keel/theme.ts`, `keel/demo-static/world.ts`); the preset conformance check names no tenant. And the proof
suite never used the seed: `runRlsProofs` (`keel/db/rls-proof-runner.ts`) creates its own two tenants and an
organization in each on every run, on pglite and on real Postgres alike, and hands both to the app's half. A
one-tenant seed therefore cannot starve a proof of its second tenant. The starter's seed cut to one tenant
type-checks and passes its i18n, preset and pglite RLS suites.

**What is lost.** The Decision's second clause. With one seeded tenant, nothing in the running app lets
anyone SEE isolation; the proof suite is the only evidence it holds for the adopter's own tables. That is
why the proviso names the proof half and not the seed: it must not be left empty, or one-sided, once the app
has tables of its own. An app's own e2e that signs in as a second tenant's person (the starter's
`items.spec.ts` and the showcase's `tenancy.spec.ts` do) is that app's content, and goes in the same
commit that shrinks its seed.

**Not enforced by a gate.** What is enforced is structural and independent of the seed:
`proveRlsCoverage` fails any relation `app_user` can reach, bar its three named exemptions, that lacks
`ENABLE` + `FORCE` row-level security and a policy keyed on `app.current_tenant`. Whether an app's half then exercises two tenants is a
question about what its assertions say, and no cheap check answers it: counting that the half touched both
tenant ids, or names each table, is satisfied by a comment or an `expect(1)`, and would reject the empty
half that an app with no tables of its own is allowed. It stays a convention, carried by the `/new-entity` and
`/new-slice` scaffolds (which now say to write each table's section of the proof half, using both proof
tenants) and by review.

## Addendum — 2026-11-16 (later): the raw-client lint ban is deny-by-default

"A lint rule bans reaching for the raw client (`getDb`) in request paths" was true only for the directories
the ban named: routes, components, and later domain/ and jobs/. A `'use server'` action kept in `src/actions`
or `src/lib` served requests with no ban at all. The ban is now `keel/no-raw-db-handle`, a rule of its own
id that covers every module in an app's `src/`, keel's screens and keel's fixture. Its one exception is a
test outside routes, screens and the fixture. Anything else that needs the raw client is a named exception
in `eslint.config.mjs` with its reason; there are none today. As before, the ban is a fast, local reminder,
and RLS in the database is the boundary.

## Addendum — 2026-11-16 (later still): who may switch to `app_user`

The Decision says every tenant-scoped transaction runs `SET LOCAL ROLE app_user`. It never said which
role is allowed to, and on every engine this repo tested, the answer was "the superuser, which may switch
to anything". That is not the role a deployment connects as.

**The failure.** Migration 0001 creates `app_user` and grants it to nobody. Aurora's master user is not a
superuser: AWS documents it as a member of `rds_superuser`, with `CREATEROLE` and `CREATEDB`. Since Postgres 16, a non-superuser that creates a role is granted ADMIN on it,
but not SET (`createrole_self_grant` is empty by default). So the owner that ran every migration could
not switch to the role it had created. Every `withTenant` failed closed with
`permission denied to set role "app_user"`. Nothing leaked, but a real deployment could not serve a single
tenant-scoped query. An independent reviewer reported it, relayed by the keel manager. The contract suite
reproduced it on Postgres 18.4, with a fresh cluster where the owner created `app_user` itself. The rule
is the same on Aurora's 16.10 (`infra/stack.ts`), and CI's postgres:16 contract job measures it on every
run (below).

**The fix: framework migration `0015_app_user_grant`.** It grants the MIGRATING role
`app_user WITH SET TRUE, INHERIT FALSE`, and only if `pg_has_role(current_user, 'app_user', 'SET')` is
false:

- a superuser (CI's, pglite's) already passes that check and gets nothing;
- a re-run gets nothing;
- a role with no ADMIN on `app_user` fails the migration with the statement an operator must run instead.

The grant takes SET because that is what `withTenant` uses. It takes INHERIT FALSE because the migrating
role owns every table, so `app_user`'s privileges add nothing it needs, and inheriting them would quietly
hand it every future grant to `app_user`. If the role already holds a membership it granted itself (an operator set
`createrole_self_grant`), SET is added to that membership and its INHERIT is left alone.

**Two databases on one cluster are the same problem twice.** Take staging and production on one Aurora
cluster, migrated by different owners. `app_user` is cluster-wide, so only the owner that migrated first
created it and holds ADMIN on it. The second owner has no membership at all: 0001 finds `app_user` and moves
on, and 0015 cannot grant it the switch. 0015 then fails with the statement to run, and Kysely rolls back
the whole run. A role holding ADMIN on `app_user` runs that statement, after which the second owner's
re-run finds the switch already effective and migrates. The contract suite runs exactly this, executing the
statement copied out of the error.

**A separate application role is a different case.** The `db-role-not-superuser` cutover row asks for one.
It also reads the RLS-free infra tables (`tenants`, `organizations`, `service_keys`) before any tenant is
set, and only `app_user` holds SELECT on them. So it needs
`GRANT app_user TO <app role> WITH SET TRUE, INHERIT TRUE`. It cannot make that grant itself, since it did not
create `app_user`: the role that created it (the migrating owner, whose 0001 ran first) or any role holding
ADMIN on `app_user` must. It must own nothing. With INHERIT TRUE it holds exactly `app_user`'s
privileges, and every tenant table it reaches outside `withTenant` is still bound by RLS, with no tenant
set: zero rows, and no insert passes the `WITH CHECK`.

**Postgres 16 or later is keel's minimum.** 0015 uses `pg_has_role(…, 'SET')` and `GRANT … WITH SET`,
and both arrived in Postgres 16. Every server keel targets is 16 or later: Aurora 16.10 (`infra/stack.ts`),
CI's postgres:16 contract job, pglite (Postgres 18.6) and the embedded Postgres 18.4 that a local
`pnpm test:contract` starts. So keel states the minimum (`docs/adopting.md`, "Cutover") instead of
branching on `server_version_num`. A branch for 15 would be code that no gate runs.

**The gate: a non-superuser pass in `pnpm test:contract`** (`packages/keel/src/db/owner-pass.ts`, run
from `packages/keel/src/adapters/real/db.contract.test.ts`).

- A `LOGIN CREATEROLE CREATEDB NOSUPERUSER` owner creates its own database and runs the migrations.
- Inside `withTenant` it must be `app_user`, in the tenant it asked for.
- Then the whole composed proof suite runs with every role switch made by that owner. The proof context
  gained `appDb` for this; seeding and the superuser negative control stay on `db`, unchanged.
- The pass first MEASURES what this server gives a creator. The owner creates a throwaway role and reads
  its own membership back: ADMIN, no INHERIT, no SET. CI's postgres:16 job asserts that on every run.
- The pass runs TWICE in its file, so both of its branches run every time. The first run is on a fresh
  server: a local run's embedded server is always one, and so is CI's service whenever this file runs
  before the app's. There, the owner's own 0001 creates `app_user`, which is the genuine path. The second
  run finds `app_user` already there (cluster-wide, as on any reused server), and grants the owner exactly
  the measured creator membership.
- Without 0015 the pass fails with the production error.
- The pass reaches the server only through injected `admin` and `connect` handles, so another transport
  (the Data API, #46) could run it. It does not yet.

## Addendum (2026-11-16): `withTenant` sets the role and the tenant in one statement

The Decision lists two statements: `SET LOCAL ROLE app_user`, then
`SELECT set_config('app.current_tenant', $1, true)`. `runWithTenant` now sends them as one:

```sql
SELECT set_config('role', 'app_user', true), set_config('app.current_tenant', $1, true)
```

`SET ROLE` is a setting of the `role` parameter. `set_config('role', …, true)` sets that same parameter,
transaction-locally, through the same membership check. So the first call is `SET LOCAL ROLE` in a form
that can sit in a `SELECT`. The tenant id stays a bound parameter, and the role name stays a literal.

The reason is the RDS Data API transport (ADR-0002, addendum of the same date): each statement there is
its own HTTPS call, so the setup was costing two calls per `withTenant`. On `pg` and pglite it is one
round trip fewer.

The same proofs hold on all three engines. Pointing the first `set_config` at a different parameter name
was watched turning the pglite RLS suite red, so the role really is set by it. The proofs' own
fail-closed case and their privilege-layer cases (the append-only tables, `service_keys`, and DELETE on
`agreements`) still write `SET LOCAL ROLE` directly; that form stays valid, and those cases are about
the policies and grants, not about `runWithTenant`.

## Addendum — 2026-11-16 (last): an app's raw-client exceptions live in the app

The deny-by-default addendum (2026-11-16, later) put a module that needs the raw client into `eslint.config.mjs`,
by exact path. That path names the app's directory, which `pnpm init-app` renames without rewriting keel's config,
and an adopter's edit to that file conflicts with every later keel update to it. So an app lists its exceptions in its own
`apps/<app>/lint-exceptions.mjs`, by path relative to the app, and `eslint.config.mjs` reads every app's when it
loads. Each entry names one existing file under the app's `src/` and gives a reason, or the config fails to load.

## Addendum (2026-11-17): the non-superuser pass runs through the Data API too

The addendum on who may switch to `app_user` left the pass on `pg` alone ("It does not yet"). It now also
runs through the RDS Data API (`packages/keel/src/adapters/real/rds-data.contract.test.ts`).

- Every connection the pass opens goes through the dialect, to an emulator logged in as that login, as on
  Aurora, where the secret is the login. Only `admin` stays on `pg`: it creates the owner, grants it the
  creator's membership where `app_user` already exists, and tears everything down.
- The owner migrates the Data API's way, in one transaction behind a transaction-scoped lock, through a
  `migrate` hook the pass gained. Its default is still `migrateToLatest`.
- The test also reads the calls the owner's emulator received while the migrations ran. They must be one
  transaction, opening with the transaction-scoped lock, every statement on that one id, ending in a
  commit. `withTenant`'s role switch must have arrived inside a transaction too. The owner migrating or
  connecting over `pg` instead turns it red.
- In that file `app_user` already exists, created by its superuser migration, so the pass takes the
  reused-server branch: the owner is granted exactly the creator's measured membership, and 0015 adds SET.
- Without 0015 it fails with the production error, `permission denied to set role "app_user"`, as the
  `pg` passes do.
