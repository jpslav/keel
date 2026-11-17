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

- The cluster has the Data API enabled and the migrations applied (the migrator Lambda, on either driver).
- Your shell can call `rds-data:*` on the cluster and `secretsmanager:GetSecretValue` on its secret.
- At least one tenant with rows in a tenant-scoped table (`jobs` is in every app).

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
  string, so nothing outlived the transaction.

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

Pass when the second call returns the array `uuid`, `text`.

Then check that a `:` inside a string literal or a comment is not read as a parameter. Keel's own SQL
has none today, but the emulator assumes AWS's parser skips them, and nothing else has checked:

```bash
rds execute-statement --database "$DB" --sql "SELECT ':not_a_parameter' AS literal -- :nor_this"
```

Pass when the call succeeds and returns the literal unchanged.

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

## 4. Errors

```bash
rds execute-statement --database "$DB" --sql "INSERT INTO tenants (slug, name) SELECT slug, name FROM tenants LIMIT 1"
```

This fails with a unique violation. Record the exception's name and its whole message, including whether
it ends `; SQLState: 23505`. Also roll back a transaction id that has already ended, and record that
exception's name and message: the dialect treats `TransactionNotFoundException`, or a message saying the
transaction is not found, as already rolled back. The dialect handles both forms (`normalizeDatabaseError` in
`packages/keel/src/adapters/real/rds-data-codec.ts`), but the row should say which one AWS sends.

## 5. The app on the transport

- Deploy staging with `params.database.transport` set to `'data-api'` (so `DATABASE_TRANSPORT=data-api`), and
  run the migrator Lambda with the same variables.
  It must return `{ ok: true }`. Invoke it twice at once as well. Both must return `{ ok: true }`: the
  second waits on the transaction-scoped migration lock and then finds nothing pending.
- Sign in and use a tenant-scoped screen. Then sign in as a member of the second tenant and confirm none
  of the first tenant's rows appear.
- Let a Serverless v2 cluster with minimum capacity 0 pause. The next request must still succeed, after
  the dialect's `DatabaseResumingException` retries, and the logs should show the retry.
