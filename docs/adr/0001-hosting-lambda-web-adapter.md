# ADR-0001 — Hosting: Next.js standalone on Lambda via Web Adapter

- Status: Accepted
- Approver: JP Slavinsky
- Date: 2026-08-01

## Context

The scaffold targets AWS-native serverless hosting with cheap per-PR preview environments. Two shapes
were considered.

**Next `output: 'standalone'` behind the AWS Lambda Web Adapter.** The standalone build is an ordinary
Node HTTP server; the Web Adapter layer translates a Lambda invocation into a request to it. The
deployed process is the same server `pnpm start` runs locally, so hosting changes nothing about how the
app behaves.

**OpenNext.** It buys distributed ISR and split functions, and costs SQS/DynamoDB machinery, more moving
parts, and a structural dependency on Next.js internals that has to chase every Next release — its
compatibility with a given Next version is a project you neither control nor can fix quickly.

The deciding consideration is this repo's central discipline (`docs/development-approach.md`): dev, demo
and production run identical code paths. An adapter that re-implements the Next runtime breaks that
guarantee at the one point where it is hardest to debug, and makes every Next upgrade wait on a third
party.

## Decision

**Next standalone in one Lambda behind the AWS Lambda Web Adapter layer.** The stack is authored as a
CDK draft in `infra/` (`infra/stack.ts`):

- One `Server` function (`nodejs22.x`) carrying the Web Adapter layer, exposed by a Function URL and
  fronted by CloudFront.
- `/_next/static/*` and `/assets/*` served from an S3 assets bucket through origin access control, never
  from the Lambda.
- A separate small **migrator** Lambda bundling the same migration registry the unit and contract tests
  run (`packages/keel/src/db/migrations`), invoked and required to succeed before traffic shifts.
- Aurora PostgreSQL Serverless v2, reached directly — no RDS Proxy. `serverlessV2MinCapacity` is 0
  outside production, so a dormant preview environment costs nothing.
- CloudWatch alarms on server errors and throttles, plus a budget alarm.

`infra/` is a **draft an adopter takes over**, not a finished deployment. `pnpm --filter infra synth` is
its verification bar: green, offline, zero credentials. Nothing deploys until the `cloud-accounts` and
`recurring-cost` rows of `docs/cutover-checklist.md` close. Deploys run through the adopter's own
pipeline — `.github/workflows/checks.yml` runs checks and never deploys, because the deploy pipeline is
the piece most tightly bound to an organisation's accounts and approval gates. Moving the stack out into
a dedicated infrastructure repo is a supported end state: `infra/` imports exactly one thing from the app
(`apps/showcase/config/app`), so the seam is one line wide.

## Consequences

- The deployed artifact is the same server you run locally — dev, demo and production run identical code
  paths, which is the property the rest of the scaffold is built on.
- Next version upgrades don't wait on an adapter project.
- Known trade: **no cross-instance ISR.** ISR writes land on per-instance ephemeral disk, so the app
  relies on explicit caching and dynamic rendering. A real ISR requirement is the trigger to revisit
  OpenNext, and it is the only one.
- Image optimization runs in the same Lambda; revisit only if it becomes a measured problem.
- One NAT gateway carries the in-VPC Lambda's egress to hosted auth/email/LLM services. That is a
  standing cost, named in the stack and gated by `recurring-cost`.
- The deploy shape is rehearsable before any account exists: `pnpm build:demo && pnpm start:demo` runs
  the identical standalone artifact locally against fake adapters (`docs/runbooks/deploy.md`).

## Addendum (2026-11-16): the Lambdas outside the VPC, as a deployment choice

The Decision's network shape stays the default: both Lambdas inside the VPC, and one NAT gateway for their
egress. The app's `params.database.transport` now chooses between two shapes (`infra/stack.ts`):

- **`pg` (default):** unchanged. The cluster synthesizes exactly as before, and both Lambdas now say
  `DATABASE_TRANSPORT=pg` explicitly.
- **`data-api` (opt-in):** the RDS Data API transport, from ADR-0002's addendum of the same date.
    - Only the Aurora cluster lives in the VPC, in isolated subnets with no NAT gateway and no internet
      gateway.
    - The server and migrator Lambdas run outside any VPC and reach Aurora through the RDS Data API, which
      the cluster enables.
    - IAM is the whole boundary. Each function gets the Data API actions on this one cluster's ARN and read
      on its secret (CDK's `grantDataApiAccess`), and nothing else database-related.

**What it buys:**

- no NAT gateway, the standing cost the Consequences named;
- no VPC attachment for the Lambdas;
- no database credential in the function's configuration, because the Data API reads the secret itself.
  The `db-credential-not-in-env` cutover row therefore does not arise on this shape.

**What it costs:**

- Every SQL statement is an HTTPS round trip. A `withTenant` is at least BeginTransaction, one setup
  statement, the queries, and Commit.
- The Data API's limits apply to the app and to its migrations: 1 MiB responses, 45 seconds per call,
  one hour per transaction (AWS's `BeginTransaction` API reference; the doc comment in the installed
  `@aws-sdk/client-rds-data` 3.1169.0 still says 24 hours).
- Anyone holding both the IAM grant and the secret can run SQL as the database user, so the grant is
  scoped to the one cluster. That user is the cluster's master user, as on `pg` today. Closing
  `db-role-not-superuser` on this shape means a second, non-superuser secret, and a hand-written grant
  on that secret instead of CDK's.

**Why the VPC path stays the default:**

- The Data API transport is proven only through an emulator until the `data-api` cutover row closes.
- A socket has lower latency per statement.
- A migration or query that cannot fit the Data API's limits needs the socket.

**Decide before the first deploy.** On an existing stack a switch does not replace anything: the new
subnets' CIDRs overlap the old ones, so the update fails and rolls back. Changing shape means a new
stack and a restore from a snapshot.

`pnpm --filter infra synth` now runs `infra/check-shapes.ts` after `cdk synth`. It builds BOTH shapes and
checks each against the runtime's own list of required variables, so the opt-in shape is built by a gate
even though the app's params choose `pg`. It was also run offline by hand for both shapes. The `data-api` shape has:

- no NAT gateway, no internet gateway, and two isolated subnets;
- the cluster's HTTP endpoint enabled;
- both Lambdas without VPC configuration;
- the `rds-data` and secret-read grants scoped as above.

The `pg` shape keeps its NAT gateway, its subnets, its in-VPC Lambdas and its secret-read grants. It now
sets `DATABASE_TRANSPORT=pg` explicitly on both Lambdas, and its cluster is unchanged. The cutover row
`data-api-access` proves the deployed shape.

The Decision's "`infra/` imports exactly one thing from the app" no longer holds: it imports two,
`config/app` and, for `params.database.transport`, `config/params` (`infra/app.ts`).
