---
description: Start a vertical feature slice (screen + route + port usage + tests) the house way
---

Plan and build a vertical slice for: $ARGUMENTS

A slice is APP code. It registers new entities through the `apps/showcase/src/app-config/` seam (ADR-0012) and
imports the framework freely; framework code reaches your app only through the `@app-config/*` alias, so
you never edit a framework union or switch to add a subject/kind/table — you register it. The tickets
feature is the end-to-end reference (`apps/showcase/src/components/tickets-card.tsx`, `apps/showcase/src/app/api/tickets/route.ts`,
`apps/showcase/src/app/[locale]/(protected)/dashboard/dashboard-glue.tsx`, and its seam registrations below).

House shape for a slice:

1. **Router-agnostic screen** in `apps/showcase/src/components` (props in, async callbacks out). No hard-coded strings:
   every literal goes through next-intl. Reuse an existing `apps/showcase/src/app-config/messages.ts` `APP_NAMESPACES`
   entry or register a NEW namespace there, then add its keys to BOTH `apps/showcase/messages/en.json` and
   `apps/showcase/messages/es.json` (the two catalogs must stay key- and placeholder-identical, and the framework/app
   namespace partition is test-enforced).
2. **Route handler(s)** under `apps/showcase/src/app/api/` using ports only; tenant-scoped data through
   `db.withTenant()` (never `getDb()` in a request path); auth via `auth.requireUser()`/`requireRole()`.
   Every mutating route (POST/PUT/PATCH/DELETE) MUST call `authorize(...)` (`packages/keel/src/authz/authorize.ts`) —
   the build-time mutation scan fails any route that neither calls it nor is justified in its exemption map.
3. **Authorization**: register your subject types + rules on the seam — add to `AppSubjectType`,
   `appAbilityRules` (and any two-sided fields to `AppSubjectFields`) in `apps/showcase/src/app-config/abilities.ts`,
   following the `Note`/`Escalation`/`Artifact` cases. Deny-by-default is framework-owned; you only add rules.
4. **New table**: add its interface to `AppTables` in `apps/showcase/src/app-config/db/schema.ts` (the framework `DB`
   type `extends AppTables`, so `import type { DB }` keeps working), and a migration numbered ≥1001 under
   `apps/showcase/src/app-config/db/migrations/` registered in that dir's `index.ts`. Copy the RLS pattern from
   `apps/showcase/src/app-config/db/migrations/1001_tickets.ts` (enable RLS + the tenant policy). Prove it with BOTH
   `pnpm test:unit` and `pnpm test:contract` (the RLS proofs on real Postgres).
5. **App vocabulary** registers through the matching seam module — never a framework union: job kinds +
   handlers in `apps/showcase/src/app-config/jobs.ts`, notification kinds/payloads/copy in `apps/showcase/src/app-config/notifications.ts`,
   outbound webhook event kinds in `apps/showcase/src/app-config/webhooks.ts`, inbound-email handlers in
   `apps/showcase/src/app-config/inbound-email.ts`, a Simulator tab or Snapshots flag in `apps/showcase/src/app-config/simulator.ts`. The
   framework composes each as `framework ∪ app`.
6. **Thin page + client glue** under `apps/showcase/src/app/[locale]/` (the glue owns fetching/polling; the screen stays
   router-agnostic). Ship the static-demo twin in `apps/showcase/src/demo-static/` too if the slice adds a Simulator or
   demo-world surface (the file:// build has no server — see MEMORY: static-demo feature parity).
7. **Tests**: Playwright e2e for the user-visible flow (`apps/showcase/tests/e2e/`); a Ladle story if the screen is reusable.
8. **Finish with `pnpm verify`** (add `pnpm test:contract` when you touched a migration). Work on a branch;
   conventional commits; run `/pre-pr` before opening the PR.
