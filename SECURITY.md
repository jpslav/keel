# Security policy

## Reporting a vulnerability

Report privately through **[GitHub Security Advisories](https://github.com/jpslav/keel/security/advisories/new)**.
Please do not open a public issue for a vulnerability.

Include what you did, what happened, and what you expected. A failing test or a `curl` is worth more
than a paragraph. You will get an acknowledgement within a week.

This is a small project maintained in spare time. There is no bounty, and no guaranteed fix window.
What you will get is a straight answer about whether it is a real issue and what is going to happen
about it.

## What is in scope

This template's whole point is that a security-relevant shape is built in rather than bolted on, so
the interesting reports are about that shape being wrong:

- **Tenant isolation.** The template's own tenant-scoped content tables carry `tenant_id` — a
  convention, not the guarantee; the guarantee is the reachability check described below. Postgres
  row-level
  security enforces it with `ENABLE` + `FORCE ROW LEVEL SECURITY` and both a `USING` and a `WITH CHECK`
  clause. All access runs inside `db.withTenant()`, which does `SET LOCAL ROLE app_user` first so the
  policy cannot be bypassed by a superuser connection. **A way to read or write across tenants is the
  most serious thing you can find here.** The proofs live in `packages/keel/src/db/rls-proofs.ts` and
  run against both pglite and real Postgres.

    **The word "every" above is enforced, not asserted.** `packages/keel/src/db/rls-coverage.ts` reads
    the database catalog after the registered migrations have run and fails if **anything `app_user`
    can reach** — in any schema, of any relation kind — lacks RLS, lacks `FORCE`, has no policy, or
    has a policy that never reads the tenant setting. It asks about reachability rather than about a
    `tenant_id` column on purpose: a naming convention is not a mechanism, and a table keyed on
    `org_id`, a table in another schema, and a view over a protected table were each demonstrated to
    leak while a convention-based check stayed green. Reachability is the INHERITED kind: privileges
    pass through role membership, so the check asks `pg_has_role` rather than matching grants written
    directly to `app_user` — a table granted to a role `app_user` merely belongs to was demonstrated
    to leak while an earlier, direct-grant version of this same check stayed green. A view or
    materialized view cannot carry RLS at all, so a reachable one must be named as a deliberate
    exemption. The check runs on both engines.

    It exists because it was needed: a tenant-scoped table created without its six-line RLS block
    previously passed every gate while permitting cross-tenant reads and writes.

    **A precondition this template cannot check for you.** RLS — including `FORCE` — is bypassed
    outright by a role holding `SUPERUSER` or `BYPASSRLS`. `infra/stack.ts` wires `DATABASE_URL` to the
    database's master credentials, so on that path the application connects as the table owner and
    `FORCE` is what stands between it and every tenant's rows. Confirm the role you deploy with has
    neither attribute — `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user` —
    and see the `db-role-not-superuser` row in `docs/cutover-checklist.md`. A report that RLS is
    bypassable by a superuser connection is a known non-finding; a report that the template encourages
    deploying as one is very much in scope.

    **Three framework tables are deliberately exempt**, and a report that they lack RLS is a known
    non-finding. All are INFRA tables read while resolving who is calling — before a tenant context
    exists — so `app_user` holds a cross-tenant `SELECT` on each and none carries a policy:
    `tenants` (`packages/keel/src/db/migrations/0001_tenants.ts`), the tenant registry itself;
    `organizations` (`packages/keel/src/db/migrations/0003_organizations.ts`), which holds a team's
    slug and display name; and `service_keys`
    (`packages/keel/src/db/migrations/0005_service_keys.ts`), which holds only PUBLIC key material —
    its boundary is cryptographic, a caller proving possession of the matching private key. All three
    grants are `SELECT`-only, and the coverage check asserts that from the catalog's ACLs — table
    grants **and column grants**, every privilege other than `SELECT`. It reads the ACLs rather than
    `has_table_privilege` because that function reports table-level privileges only, and a
    column-level `GRANT UPDATE (name)` was demonstrated to let `app_user` rewrite every row of the
    tenant registry while the check reported nothing. The exemption list lives in that same file and
    is pinned by an assertion, so adding one fails until this section is updated too. A way to make
    any of them leak something beyond the above — or to reach tenant CONTENT through them — is very
    much in scope.

- **Authorization.** `authorize()` is the single choke point for resource-level decisions. A build-time
  scan fails any mutating API route that neither calls it nor carries a justified exemption.
- **Service-to-service auth.** RS256 JWTs, audience-pinned, with a required `iat`/`exp` and a maximum
  age. Key material is per-org.
- **Webhook signatures.** Outbound deliveries are signed; inbound webhooks are verified before the
  handler runs, including freshness and single-use tokens. Note the recorded limit on the single-use
  half: the inbound replay store is an in-process map (`packages/keel/src/service-auth/mailgun.ts`), so
  it dedupes within one process, not across a multi-instance deployment. Timestamp freshness is the
  primary, stateless guard; making the token guard global is a cutover item, not a finding.
- **The production fail-closed guard.** A production build refuses to boot with fake adapters. See
  below — this is the one most worth understanding before you report on it.

## The simulated world, and why `/api/simulator/*` is unauthenticated

In simulated mode this template ships a **deliberately unauthenticated** developer surface: you can
read any caught email, become any person without a password, jump the world clock, and reset
everything. That is not an oversight — it is what makes the local development loop work with no
credentials and no network, and it is documented behaviour.

It is gated by **mode, not by role**, and the mode is fail-closed:

- A production build (`NODE_ENV=production`) that would use fake adapters **throws on boot** rather
  than serving them (`packages/keel/src/adapters/index.ts`). A deployment must set `APP_MODE=real`.
- The only ways past that guard are `DEMO_MODE=1` and `E2E_BUILD=1`. Both are explicit opt-ins that
  cannot be triggered by forgetting something, and `production-guard.test.ts` additionally asserts that
  no environment in `infra/stack.ts` carries either flag.

**In scope:** any way to reach a simulator route, or fake adapters generally, in a build that has not
explicitly opted in. That is a real vulnerability and we want to hear about it.

**Not in scope:** the simulator surface being open in a build that _has_ opted in — a demo deployment
is a shared world by construction, and `docs/cutover-checklist.md` carries a row (`demo-url`) requiring
that exposure decision to be recorded before any public demo URL ships.

## Also not in scope

- **Adapters marked `AUTHORED — CUTOVER`.** These are written against a vendor SDK and have never been
  run against the real service. They are typechecked, not verified, and say so in a header comment.
  Their cutover row names the proof each one owes.
- **`PLACEHOLDER_` values** in `apps/showcase/config/params.ts`. They are placeholders, not secrets.
- Findings that require an attacker to already have local filesystem or shell access to a developer's
  machine.
- Dependency CVEs with no demonstrated path to exploitation here — Dependabot already watches those.

## For adopters

If you have built on this template, a vulnerability in **your** deployment is yours to handle; this
policy covers the template. But if the root cause is a shape the template gave you, please report it
here too, because every other adopter has the same shape.
