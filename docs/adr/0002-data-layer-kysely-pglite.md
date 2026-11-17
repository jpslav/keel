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

## Addendum (2026-11-16): an opt-in second transport, the RDS Data API

Production can now reach Aurora two ways, chosen per deployment by `DATABASE_TRANSPORT`. Each app records
the choice as `params.database.transport` in its `config/params.ts`, and the deployment sets the variable
from it.

- **`pg`, the default:** node-postgres over a socket, from a Lambda inside the database's VPC.
- **`data-api`, opt-in:** the Amazon RDS Data API over HTTPS, from a Lambda outside any VPC and with no
  NAT gateway.

Both sit behind the same `db` port and run the same migrations, the same `withTenant` and the same RLS
policies. The trigger was an adopter running its console Lambda outside any VPC.

**JP's decision (2026-11-16): the Data API transport lives in keel, as an opt-in.** The reason: tenant
isolation through any transport is keel's to prove, so the proof belongs beside the policies it relies
on, not in an adopter's fork. Being opt-in means three things:

- **`pg` stays the default.** An unknown transport fails rather than falling back to it.
- **The transport is loaded only when chosen.** `packages/keel/src/adapters/real/db-data-api.ts` is
  reached only by dynamic import, from `createRealPorts` and the migrator. So a `pg` deployment never
  loads the RDS Data SDK, which `packages/keel/src/adapters/real/index.test.ts` proves by watching the
  module loads.
- **Dev never reaches it.** `pnpm dev` and the static demo never import the real adapters at all.

The SDK sits inside the vendor fence. The transport adds five internal modules to `packages/keel` and
publishes none, which takes the internal count `docs/adopting.md` states from 37 to 42.

**Tenant context through the Data API — what is known, and how.** `runWithTenant` sets the role and the
tenant transaction-locally, then runs the caller's queries. Through the Data API every statement is a
separate `ExecuteStatement` call, all sharing one `transactionId`.

- **AWS documents** that the Data API pools connections and resets each one with `DISCARD ALL` before
  reusing it (Aurora User Guide, "Session management with Amazon RDS Data API"). So nothing session-level
  survives between calls outside a transaction.
- **AWS states** that an explicit transaction is what keeps session state between calls: "If the
  transaction is not used, there is no guarantee these API calls will use the same connection, and the
  session state changes would be cleared" (AWS Database Blog, "Enforce row-level security with the RDS
  Data API", 15 May 2024).
- **Postgres guarantees** the rest. A transaction lives on one backend, transaction-scoped settings last
  until COMMIT or ROLLBACK, and `DISCARD ALL` cannot run inside a transaction block.

So the settings `withTenant` relies on persist across every statement of one Data API transaction, and
are gone after it. That is documented and inferred, **not yet observed on a live cluster**.
`docs/runbooks/data-api.md` is the exact procedure that proves it; it closes the `data-api` cutover row.

Because each statement is a round trip, `withTenant` now sets the role and the tenant in ONE statement:
`set_config('role', 'app_user', true)`, which is `SET LOCAL ROLE`, beside the tenant's `set_config`.
ADR-0004's addendum of the same date records that change. Setup is one round trip on every transport.

**The dialect is hand-written, as the pglite one is.** The community `kysely-data-api` (MIT, last
published March 2025) declares `kysely ^0.27` against keel's 0.29. More decisively, it sends parameters
untyped and returns `date` as a `Date`. Those two choices break keel's queries and its dates-are-strings
rule respectively.

**Parameters are typed by asking Postgres.** keel's SQL relies on node-postgres sending every parameter
untyped, so Postgres infers `$1` from context. The Data API cannot do that: an untyped string arrives as
`varchar`, and `uuid = varchar` is an error on Aurora. A per-value guess at a type hint would break
`set_config`'s text argument the moment a tenant id looked like a uuid. So the dialect PREPAREs each SQL
shape once per process and reads Postgres's own inference from `pg_prepared_statements.parameter_types`.
It then sends every value as a string inside an explicit `CAST(:name AS <type>)`. That reproduces
node-postgres's semantics rather than approximating them. It is also how arrays get through at all: the
Data API rejects array parameters, but an array literal cast to `uuid[]` is a string. A warm process pays
nothing extra. A new SQL shape costs three extra calls inside a transaction (PREPARE, the read, DEALLOCATE)
and five outside one, which also needs its own short transaction.

**What the Data API cannot do fails loudly.** The dialect refuses, before calling, anything it cannot honour:

- transaction control written in SQL;
- session state outside a transaction (`SET`, `SET ROLE`, `PREPARE`, temporary tables,
  `set_config(…, false)`, session-level advisory locks);
- streaming.

**The migration lock is transaction-scoped.** Kysely's own migration lock is a session-level
`pg_advisory_lock` on a separate connection, and it creates its bookkeeping tables before locking at all.
On the Data API that lock would be released by the connection reset before the migrations ran. So the
Data API port runs the Migrator inside one transaction that opens with `pg_advisory_xact_lock`. It uses
Kysely's own lock id, so a `pg` migrator and a Data API migrator also exclude each other. A second
migrator waits for at most the 45-second call timeout and then fails loudly.

**A failed commit keeps its own error.** A deferred constraint's `23505` comes back with its `code` and
`constraint`, not as a complaint from the rollback Kysely sends after a failed commit.

AWS's own limits surface as errors, never as truncation:

- a 1 MiB response cap;
- a 45-second call timeout;
- a transaction that ends after three idle minutes or one hour;
- SQL of at most 65,536 characters;
- a paused cluster that takes more than about 15 seconds to resume, which the dialect stops retrying.

The Data API returns database errors as a message, sometimes ending `; SQLState: 23505` and sometimes
not. So the dialect sets `code` and `constraint` the way node-postgres does. It reads them from the
stated SQLSTATE, or else from Postgres's own wording for the errors code acts on. The showcase's
ticket-reference retry keys on `23505`.

**Proof without AWS.** `pnpm test:contract` gains a third run,
`packages/keel/src/adapters/real/rds-data.contract.test.ts`. It runs the migrations and the full RLS proof
suite through the dialect, against `packages/keel/src/adapters/real/rds-data-emulator.ts`. The emulator is
a test-only stand-in that executes each call on real Postgres with the Data API's documented semantics,
and it is deliberately strict:

- an untyped string binds as `varchar`;
- array parameters are refused;
- connections are reset with `DISCARD ALL`;
- errors carry no SQLSTATE.

Four negative controls prove that strictness: varchar binding, array refusal, the connection reset, and
SQLSTATE-less errors. So the dialect's casts and its error handling are what make the proofs pass. A
battery writes and reads every column type keel uses through both transports. It requires identical rows
both ways: what each reads, and what each wrote. Two migrators racing on an empty database prove the
lock. Nothing in
`pnpm dev` changes: dev, the e2e suite and the static demo still run on pglite fakes. The emulator is a
contract-test instrument, not a fake, in the sense of `docs/development-approach.md`'s "Fakes over
emulators".

**Not proven, and owed by the `data-api` cutover row:**

- AWS's exact wire format, which the emulator takes from PgJDBC conventions (column type names, the
  `timestamptz` string, error wording);
- that PREPARE and `pg_prepared_statements` work through the Data API;
- the retry on a paused Serverless v2's `DatabaseResumingException`.
