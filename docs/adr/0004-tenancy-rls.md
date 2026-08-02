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
