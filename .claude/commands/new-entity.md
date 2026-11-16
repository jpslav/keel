---
description: Add a domain entity (subject + RLS table + abilities) through the app-config seam
---

Add a domain entity for: $ARGUMENTS

This is the entity core of a slice — use `/new-slice` for the full screen-to-e2e flow; use this when
the entity arrives without its own UI (or before it):

1. **Subject + rules**: add the type to `AppSubjectType` and its rules to `appAbilityRules` in
   `apps/showcase/src/app-config/abilities.ts` (two-sided org fields go in `AppSubjectFields`; `Escalation` is the
   two-sided reference, `Ticket`/`Attachment` the single-org ones). Deny-by-default is framework-owned —
   you only add allows. Cover the rules in `apps/showcase/src/app-config/abilities.test.ts`.
2. **Table**: interface in `AppTables` (`apps/showcase/src/app-config/db/schema.ts`); migration numbered ≥1001 in
   `apps/showcase/src/app-config/db/migrations/` + registered in its `index.ts`; copy the RLS pattern from
   `1001_tickets.ts` (enable RLS + tenant policy; app tables may reference framework tables, never the
   reverse). Then write the table's section in `apps/showcase/src/app-config/db/rls-proofs.ts`, using BOTH
   tenants the proof runner hands that file (`alphaTenantId`, `demoTenantId`): reads isolated both ways
   under unfiltered selects, and a cross-tenant INSERT rejected by `WITH CHECK`. The coverage check only
   proves the table is protected; nothing else proves your proofs cross a tenant boundary (ADR-0004,
   addendum of 2026-11-16).
3. **Data access** in `apps/showcase/src/domain/db/<entity>.ts`, pure logic in `apps/showcase/src/domain/<entity>.ts`
   (`escalations` is the reference pair). Tenant-scoped queries only via `db.withTenant()`.
4. **Vocabulary**: audit actions in `apps/showcase/src/app-config/audit.ts`; notification/webhook kinds via
   `/new-notification-kind` and `/new-webhook-event` if the entity emits them.
5. **Routes** that mutate MUST call `authorize(...)` (build-time scan enforces).
6. Finish with `pnpm verify` AND `pnpm test:contract` (you touched a migration).
