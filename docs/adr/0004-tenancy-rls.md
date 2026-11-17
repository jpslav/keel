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
negative-control and fail-closed cases still write `SET LOCAL ROLE` directly; that form stays valid, and
those cases are about the policies, not about `runWithTenant`.
