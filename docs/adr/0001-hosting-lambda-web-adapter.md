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
