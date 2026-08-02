# infra/ — CDK app (DRAFT)

The application stack per ADR-0001: Next standalone server in one Lambda via the AWS Lambda Web
Adapter, Function URL behind CloudFront, static assets from S3, migrator NodejsFunction bundling the
app's own migration registry, Aurora PostgreSQL Serverless v2 (min-capacity 0 outside production),
budget alarm.

This is a **draft you are meant to take over**, not a finished deployment. It exists so the hosting
decision is written down in runnable form rather than as prose — and so `pnpm --filter infra synth`
proves the shape compiles offline before anyone has an AWS account.

## Status: authored — cutover

- `pnpm --filter infra synth` is the verification bar: green, offline, zero credentials
  (environment-agnostic stack, no lookups).
- **Nothing here deploys until** (see `docs/cutover-checklist.md`): `cloud-accounts` fills
  `apps/showcase/config/params.ts` · `recurring-cost` — Aurora, the NAT gateway, and CloudFront need
  explicit approval. Not a checklist row, but do it first: if your organisation ships its own CDK
  construct library, replace `lib/tags.ts` and the IAM/secrets/monitoring drafts with it.

## Deploys — checks in CI, deploys in your own pipeline

`.github/workflows/checks.yml` runs checks only; there is deliberately no GitHub Actions CD here,
because the deploy pipeline is the piece most tied to an organisation's accounts and approval gates.
The shape this stack assumes: a pipeline that uploads the standalone build zip the `Server` function
expects (see `assets/placeholder-lambda/run.sh`) and invokes the `Migrator` before shifting traffic.
Cutover row `deploy-pipeline` is where that gets built.

## Moving it out of the app repo

Infra often belongs in an organisation's own infrastructure repo rather than beside the app. If that
is your situation:

1. Copy this directory there (drop `lib/tags.ts`; import your own tagging construct instead).
2. Wire `apps/<app>/config/params.ts` values through CDK context per that repo's conventions.
3. `cdk synth` from its new home; delete this directory from the app repo.

Nothing in `infra/` may depend on app source beyond `config/app.ts` and `config/params.ts`, which is
what makes that move mechanical. Note that `infra/` is not covered by `pnpm typecheck` — it is
excluded from the root program and verified by `synth`.
