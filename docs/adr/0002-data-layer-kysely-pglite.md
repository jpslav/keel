# ADR-0002 — Data layer: Kysely, pglite locally, Aurora in production

- Status: Accepted
- Approver: JP Slavinsky
- Date: 2026-08-01

## Context

Hermetic local development (no docker, no credentials, no network) requires an in-process Postgres, and
it has to run the _same migrations_ as production — otherwise the local database is a different database
wearing a costume. Two consequences fall out of that requirement, and they decided this ADR.

**The migration runner must be able to talk to the in-process database.** Prisma's CLI cannot drive
pglite, so choosing Prisma means hand-writing a second migration runner for local dev — the exact
divergence the hermetic rule exists to prevent — and it carries documented WASM/engine bundling caveats
on Lambda besides.

**Tenancy is enforced in SQL, not by query discipline** (ADR-0004). Row-level-security policies, `GRANT`s
and a non-superuser role are DDL that no schema DSL expresses; they have to be hand-written as SQL in
migrations under any ORM. A query builder that treats SQL as a first-class citizen fits that. An ORM that
treats it as an escape hatch does not.

## Decision

**Kysely over the `pg` driver.** Migrations are TypeScript modules run by Kysely's own `Migrator`
(`packages/keel/src/db/migrate.ts`), so identical migration code executes on all three engines:

| Engine                                   | Where                                                             |
| ---------------------------------------- | ----------------------------------------------------------------- |
| pglite (in-process, WASM)                | `pnpm dev`, the simulated world, unit tests                       |
| embedded-postgres (real Postgres, local) | `pnpm test:contract` — the anti-drift gate, and CI's contract job |
| Aurora PostgreSQL                        | production, through the migrator Lambda (ADR-0001)                |

RLS SQL is embedded in migrations through Kysely's `sql` template. The framework owns migrations
0001–0999 (`packages/keel/src/db/migrations`); an app registers its own from 1001 upward through the
`@app-config/*` seam (ADR-0012).

The `DB` schema type is maintained in lockstep with those migrations
(`packages/keel/src/db/schema.ts`, composed with the app's `AppTables`). Generating it from a migrated
database with kysely-codegen is the intended end state, and it is cheap precisely because pglite makes a
migrated database free; until that lands, what keeps the lockstep honest is the contract suite running
the same proofs against real Postgres.

## Consequences

- No custom migration runner, no engine/WASM bundling on Lambda, and SQL-first fits the RLS tenancy
  design instead of fighting it.
- No declarative schema DSL: the schema lives in migrations, and the schema type is maintained beside
  them rather than derived from them.
- Nested reads are joins, not `include` — acceptable for a thin domain layer, and considerably less
  surprising about what SQL actually runs.
- Three engines are three chances to drift, which is why one proof suite runs on pglite AND on real
  Postgres rather than each engine having its own.

## Two findings from the proving spike, which still shape the code

The decision was proved before it was adopted, in `spikes/kysely-pglite/` — a committed harness whose
proofs run fully offline, with no docker and no credentials. They demonstrate read isolation in both
directions under an unfiltered `selectAll`; a **superuser negative control** (without `SET LOCAL ROLE`,
pglite's BYPASSRLS superuser sees every row, which is what proves the isolation assertions are not
vacuous); fail-closed zero rows when the role is set but no tenant context is; a cross-tenant INSERT
rejected by `WITH CHECK`; and scoped writes visible. Two of its findings are load-bearing today.

1. **The community pglite dialect for Kysely was unusable** — it predates Kysely's `kysely/migration`
   export split and fails to load. The scaffold hand-rolls a small dialect from Kysely's exported
   Postgres building blocks, with a mutex-serialized single connection. It is now
   `packages/keel/src/adapters/fake/pglite-dialect.ts`, an internal of the framework package.
2. **`current_setting` returns an empty string, not NULL, on any session that has ever `SET LOCAL` a
   custom GUC** — and `''::uuid` throws. So every policy reads
   `NULLIF(current_setting('app.current_tenant', true), '')::uuid`, which makes an unset tenant context
   mean zero rows rather than an error. Getting that backwards turns a fail-closed design into a
   500-on-every-request design, and only a real transaction sequence reveals it.
