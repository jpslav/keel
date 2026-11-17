# Runbook: the RDS Data API driver, proven live

> **Status: pre-cutover.** The opt-in `data-api` transport is proven against real Postgres through a strict
> emulator in `pnpm test:contract`, never against the Data API itself. This is the procedure that
> closes the `data-api` row of `docs/cutover-checklist.md`. Run it against a staging cluster, never
> production, and record what each step returned in that row.

ADR-0002's addendum of 2026-11-16 explains the transport and separates what is documented from what is
proven. The dialect is `packages/keel/src/adapters/real/rds-data-dialect.ts`. It is selected with
`DATABASE_TRANSPORT=data-api` plus `DATABASE_CLUSTER_ARN`, `DATABASE_SECRET_ARN` and `DATABASE_NAME`
(`packages/keel/src/adapters/real/index.ts`), which the deployment sets from the app's
`params.database.transport`.

## Preconditions

- The cluster has the Data API enabled. Steps 1–4 need a database with the migrations applied, by the
  migrator on either transport. Step 5 needs one no migrator has touched, so that every migration goes
  through the Data API: see there.
- Your shell can call `rds-data:*` on the cluster and `secretsmanager:GetSecretValue` on its secret.
- For steps 1–4, at least one tenant with rows in a tenant-scoped table (`jobs` is in every app).

```bash
export CLUSTER=arn:aws:rds:REGION:ACCOUNT:cluster:NAME
export SECRET=arn:aws:secretsmanager:REGION:ACCOUNT:secret:NAME
export DB=your_database
export TENANT=a-tenant-uuid
rds() { aws rds-data "$@" --resource-arn "$CLUSTER" --secret-arn "$SECRET"; }
```

## 1. Tenant context lasts for one transaction, and no longer

This is the question the transport rests on. Run the calls one at a time. The second is the statement
`withTenant` itself sends (`packages/keel/src/db/with-tenant.ts`):

```bash
TX=$(rds begin-transaction --database "$DB" --query transactionId --output text)
rds execute-statement --database "$DB" --transaction-id "$TX" \
  --sql "SELECT set_config('role', 'app_user', true), set_config('app.current_tenant', '$TENANT', true)"
rds execute-statement --database "$DB" --transaction-id "$TX" \
  --sql "SELECT current_user, current_setting('app.current_tenant', true)"
rds execute-statement --database "$DB" --transaction-id "$TX" \
  --sql "SELECT count(*), count(*) FILTER (WHERE tenant_id <> '$TENANT'::uuid) FROM jobs"
rds commit-transaction --transaction-id "$TX"
rds execute-statement --database "$DB" --sql "SELECT current_user, current_setting('app.current_tenant', true)"
```

Pass when:

- the third call returns `app_user` and `$TENANT`, so the role and the tenant reached a later call;
- the fourth returns the tenant's own count and **0** in the second column;
- the last call, after the commit, returns the secret's user (not `app_user`) and NULL or an empty
  string, so nothing outlived the transaction;
- `commit-transaction` answered `"transactionStatus": "Transaction Committed"`, the only answer the dialect
  takes for a commit (`commitOutcome` in `packages/keel/src/adapters/real/rds-data-codec.ts`). Record it
  exactly.

Then send a statement on a transaction id that has ended: the one just committed, and a second left idle
past the three-minute limit.

```bash
rds execute-statement --database "$DB" --transaction-id "$TX" \
  --sql "SELECT current_user, current_setting('app.current_tenant', true)"
TX=$(rds begin-transaction --database "$DB" --query transactionId --output text)
rds execute-statement --database "$DB" --transaction-id "$TX" \
  --sql "SELECT set_config('role', 'app_user', true), set_config('app.current_tenant', '$TENANT', true)"
sleep 200
rds execute-statement --database "$DB" --transaction-id "$TX" \
  --sql "SELECT current_user, current_setting('app.current_tenant', true)"
```

Pass when the first and the last call both FAIL, with no row returned. If AWS ran either outside a
transaction instead, the tail of a `withTenant` that outlived the idle limit would run as the secret's
user with no tenant, and that user is not bound by RLS: stop, and treat the transport as unsafe. Record
each exception's name and message.

## 2. Postgres's parameter inference works through the Data API

The dialect PREPAREs each new statement shape and reads `pg_prepared_statements`:

```bash
TX=$(rds begin-transaction --database "$DB" --query transactionId --output text)
rds execute-statement --database "$DB" --transaction-id "$TX" \
  --sql 'PREPARE keel_probe AS SELECT id FROM tenants WHERE id = $1 AND slug = $2'
rds execute-statement --database "$DB" --transaction-id "$TX" \
  --sql "SELECT parameter_types::text[] FROM pg_prepared_statements WHERE name = 'keel_probe'"
rds rollback-transaction --transaction-id "$TX"
```

Pass when the third call, the `SELECT`, returns the array `uuid`, `text`.

Then check what those casts exist for: an untyped string parameter arrives as `varchar`, as the emulator
binds it (`packages/keel/src/adapters/real/rds-data-emulator.ts`):

```bash
rds execute-statement --database "$DB" --sql "SELECT pg_typeof(:p)::text AS t" \
  --parameters '[{"name":"p","value":{"stringValue":"x"}}]'
```

Pass when it returns `character varying`. If it does not, the emulator is stricter than AWS; correct it.

Then check that a `:` inside a string literal or a comment is not read as a parameter. Keel's own SQL
has none today, but the emulator assumes AWS's parser skips them, and nothing else has checked:

```bash
rds execute-statement --database "$DB" --sql "SELECT ':not_a_parameter' AS literal -- :nor_this"
```

Pass when the call succeeds and returns the literal unchanged.

Two harder shapes of the same rule: an E-string, where `\'` is a quote inside the literal, and nested
block comments, which Postgres allows. The dialect and the emulator read both the way Postgres does, by one
scanner (`sqlSegments` in `packages/keel/src/adapters/real/rds-data-codec.ts`):

```bash
rds execute-statement --database "$DB" \
  --sql "SELECT E'it\\'s :not_a_parameter' AS a /* outer /* inner :nor_this */ :nor_that */"
```

Pass when it returns `it's :not_a_parameter`. If AWS reads any of the three as a parameter, its scanner is
weaker than Postgres's: make the emulator follow it, and keep such text out of keel's SQL.

And check the other side of that rule, an accepted limit in ADR-0002's addendum: a colon directly before
a name outside a literal IS read as a parameter, and a space after the colon stops it:

```bash
rds execute-statement --database "$DB" --sql "SELECT (ARRAY[10,20,30])[1:hi] FROM (SELECT 2 AS hi) AS s"
rds execute-statement --database "$DB" --sql "SELECT (ARRAY[10,20,30])[1 : hi] FROM (SELECT 2 AS hi) AS s"
```

Pass when the first call fails for want of a parameter `hi` and the second returns the elements 10 and 20. If the
first succeeds, AWS's parser is more forgiving than the emulator; correct the addendum's limit.

## 3. The wire format matches the emulator's

```bash
rds execute-statement --database "$DB" --include-result-metadata \
  --result-set-options decimalReturnType=STRING,longReturnType=STRING \
  --sql "SELECT now() AS ts, '2026-10-03'::date AS d, '{2026-10-03}'::date[] AS ds, gen_random_uuid() AS u,
         '{\"a\":1}'::jsonb AS j, 9007199254740993::int8 AS big, 1.5::numeric AS n, true AS b, '\\x00ff'::bytea AS by"
```

The emulator (`packages/keel/src/adapters/real/rds-data-emulator.ts`) assumes the following, and the dialect
decodes on those assumptions. Pass when each holds; for any that does not, fix the decoder and the
emulator together:

- `columnMetadata[].typeName` is Postgres's type name: `timestamptz`, `date`, `_date`, `uuid`, `jsonb`,
  `int8`, `numeric`, `bool`, `bytea`.
- `ts` is a `stringValue` of UTC wall-clock time, `YYYY-MM-DD HH:MM:SS[.ffffff]`, with no zone.
- `big` and `n` are `stringValue`s; `ds` is an `arrayValue` of `stringValues`; `by` is a `blobValue`.

Then a response over the 1 MiB cap, in rows that each stay under the 64 KB per row that AWS's
troubleshooting page also lists, so that a failure is the cap's:

```bash
rds execute-statement --database "$DB" --sql "SELECT repeat('x', 60000) AS big FROM generate_series(1, 20)"
```

Pass when it fails. Record the exception's name and message; the emulator answers "Database returned more
than the allowed response size limit". This is the limit a page of rows with unbounded text meets on this
transport where `pg` returns it (ADR-0002's addendum, accepted limits).

Then one row over that 64 KB, which the emulator does not model:

```bash
rds execute-statement --database "$DB" --sql "SELECT repeat('x', 100000) AS big"
```

Record whether it succeeds. If it fails, a text field over 64 KB cannot be read through this transport
at all, even one row at a time: add that to ADR-0002's accepted limits, and to the emulator.

## 4. Errors

```bash
rds execute-statement --database "$DB" --sql "INSERT INTO tenants (slug, name) SELECT slug, name FROM tenants LIMIT 1"
```

This fails with a unique violation. Record the exception's name and its whole message, including whether
it ends `; SQLState: 23505`. The dialect handles both forms (`normalizeDatabaseError` in
`packages/keel/src/adapters/real/rds-data-codec.ts`), but the row should say which one AWS sends.

Also roll back a transaction id that has already ended, and record that exception's name and message: the
dialect treats `TransactionNotFoundException`, or a message saying the transaction is not found, as already
rolled back (`isTransactionGone` in `packages/keel/src/adapters/real/rds-data-dialect.ts`).

Last, record the exception names for three requests the Data API should refuse before running anything:

```bash
rds execute-statement --database "$DB" --sql "SELECT 1 -- $(head -c 70000 /dev/zero | tr '\0' x)"
rds execute-statement --database "$DB" --sql "SELECT 1 WHERE 1 = ANY(:xs)" \
  --parameters '[{"name":"xs","value":{"arrayValue":{"longValues":[1]}}}]'
rds execute-statement --database "$DB" --sql "SELECT 1; SELECT 2"
```

The emulator names all three `ValidationException`, and the dialect takes that name to mean the request
never reached the database, so a transaction it happened in stays usable. If AWS sends another name, change
both. (The dialect refuses a multistatement itself before calling; the third request checks the emulator's
model of AWS.)

## 5. The app on the transport

- **On an EMPTY database.** On the `data-api` network shape the Data API is the migrator's only way in, so
  every migration must be seen to go through it: deploy staging with `params.database.transport` set to
  `'data-api'` (so `DATABASE_TRANSPORT=data-api`) as a new stack, whose new cluster's database (named
  `APP_SLUG` by `infra/stack.ts`) no migrator has touched. Point `$CLUSTER`, `$SECRET` and `$DB` at that
  cluster, its secret and that database for the rest of this step. Invoke the migrator Lambda. It must
  return `{ ok: true }`, and then

    ```bash
    rds execute-statement --database "$DB" --sql "SELECT count(*) FROM kysely_migration"
    ```

    must equal the number of migrations the framework and the app register: the entries of
    `packages/keel/src/db/migrations/index.ts` plus those of the app's own, such as
    `apps/showcase/src/app-config/db/migrations/index.ts`. That one run proves on AWS what only the emulator has shown: DDL in
    one Data API transaction, the describe step for the migrator's bookkeeping inserts inside it, and
    0001's `DO` block.

- **The `DO` block, asked on its own.** AWS refuses multistatements. Whether that check looks inside a
  dollar-quoted body, where 0001's `;` sits, is not documented:

    ```bash
    rds execute-statement --database "$DB" --sql 'DO $$ BEGIN PERFORM 1; PERFORM 2; END $$'
    ```

    Pass when it succeeds. If AWS refuses it, keel changes 0001, not the migrator: the migration checks
    `pg_roles` for `app_user` from its TypeScript and sends `CREATE ROLE app_user NOLOGIN` alone, one
    statement per call. 0001's is the only dollar-quoted body in keel's migrations and both apps'. An
    adopter's PL/pgSQL function would meet the same refusal, and its migration could run only on the `pg`
    shape: on `data-api` nothing but the Data API reaches the database (the first bullet above).

- Invoke the migrator twice at once. Both must return `{ ok: true }`: the second waits on the
  transaction-scoped migration lock and then finds nothing pending.
- Sign in and use a tenant-scoped screen. Then sign in as a member of the second tenant and confirm none
  of the first tenant's rows appear. The database the first bullet migrated starts with no tenants (no
  migration creates one): give it two, each with a member, and rows for the first, before this check.
- Let a Serverless v2 cluster with minimum capacity 0 pause. The next request must still succeed, after
  the dialect's `DatabaseResumingException` retries, and the logs should show the retry.
