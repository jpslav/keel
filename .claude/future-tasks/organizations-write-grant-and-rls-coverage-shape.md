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

2. **The coverage proof can't express that.** `RLS_EXEMPT` itself only maps a table to a one-line
   reason it's exempt — it carries no privilege information at all. The actual privilege check is a
   separate catalog query (ACL rows where `privilege_type <> 'SELECT'`, including column-level
   grants) applied UNIFORMLY to every exempt table, failing with "`app_user` holds
   `<privilege>`... which SECURITY.md promises is SELECT-only" the moment any exempt table has any
   non-`SELECT` grant at all. There is no per-table way to say "this one legitimately needs more."
   Need: let a table in `RLS_EXEMPT` declare which non-`SELECT` privileges it's allowed to hold, so
   the uniform SELECT-only check becomes the default for tables that don't declare an exception,
   rather than an unconditional rule every exempt table must satisfy.

**Separately, a related schema need:** nothing today lets another table hold a tenant-composite
foreign key into `organizations` (referencing both its tenant and its id together) — only a
single-column id reference is possible. A product that wants that referential-integrity guarantee —
"this row's org really does belong to this row's tenant, enforced by Postgres" — needs a composite
uniqueness constraint on `organizations` to reference.

Evidence: `packages/keel/src/db/rls-coverage.ts` (`RLS_EXEMPT`'s reason-only shape, and the
privilege-catalog query/assertion that would need to consult a per-table exception instead of
flagging any non-`SELECT` grant unconditionally), `packages/keel/src/db/migrations/0003_organizations.ts`
(today's `SELECT`-only grant and the migration a write-grant follow-up would match).
