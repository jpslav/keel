# Organizations needs a write grant, and RLS coverage needs per-table shape

**Priority:** P2 · **Status:** open

Two related gaps in how `organizations` is modeled:

1. **No write grant.** `app_user` has `SELECT` only on `organizations` — fine while every write to it
   is seed data or the auth port's own background sync, but a product that lets users create, rename
   or delete an organization at request time hits a bare permission-denied error the day that route
   ships. Need: a migration granting `INSERT, UPDATE, DELETE` as well, with `organizations` still
   carrying no row-level security of its own (a team is a collaboration boundary inside one tenant,
   not a hostile-isolation boundary — who may write stays an authorization-layer decision, not a
   grant-layer one).

2. **The coverage proof can't express that.** Whatever checks RLS-exempt tables' privileges assumes
   every exempt table is `SELECT`-only. Once one of them legitimately needs more, that blanket
   assumption is wrong for that table specifically — the fix is recording, per exempt table, which
   non-`SELECT` privileges (if any) `app_user` may hold, not loosening the check for every table.

**Separately, a related schema need:** nothing today lets another table hold a tenant-composite
foreign key into `organizations` (referencing both its tenant and its id together) — only a
single-column id reference is possible. A product that wants that referential-integrity guarantee —
"this row's org really does belong to this row's tenant, enforced by Postgres" — needs a composite
uniqueness constraint on `organizations` to reference.

Evidence: `packages/keel/src/db/rls-coverage.ts` (the exemption/coverage shape this would need to
grow a per-table privilege list), `packages/keel/src/db/migrations/0003_organizations.ts` (today's
`SELECT`-only grant and the migration a write-grant follow-up would match).
