# Runbook: deploy

> **Status: pre-cutover.** Nothing deploys yet — steps marked ⛔ are gated on cutover rows
> (`docs/cutover-checklist.md`). This runbook exists now so the shape of a deploy is decided before
> the first one happens.

## The moving parts (ADR-0001)

- Artifact: the `output: 'standalone'` build zipped with `run.sh` at its root (the exact thing
  `pnpm start:demo` runs locally via `scripts/serve-standalone.mjs`).
- Stack: `infra/` — server Lambda + Web Adapter layer, CloudFront, S3 assets, migrator Lambda, Aurora
  Serverless v2. It is a draft you take over, and it can move into your own infrastructure repo: it
  imports exactly one thing from the app (`apps/showcase/config/app.ts`).
- Pipeline: yours (cutover `deploy-pipeline`). `.github/workflows/checks.yml` runs checks and **never
  deploys**, deliberately — the deploy pipeline is the piece most tied to an organisation's accounts and
  approval gates, so the template declines to guess it.

## Deploy sequence

1. ⛔ Pipeline builds `pnpm build` (real mode env), zips the app's `.next/standalone` + static assets
   (build outputs live under the app — `apps/showcase/` today). Monorepo caveat: Next nests the
   standalone output under the app's path relative to the workspace root, so `server.js` is NOT at the
   zip root — `scripts/serve-standalone.mjs` shows where to find it and where the static assets have
   to land beside it.
2. ⛔ Upload zip to the deploy bucket; sync the app's `.next/static` + `public/` to the assets bucket
   (`/_next/static/*` and `/assets/*` behaviors are served from S3, not the Lambda).
3. ⛔ Invoke the **Migrator** Lambda and require success before traffic shifts — it runs the same
   `packages/keel/src/db/migrations` registry unit and contract tests run.
4. ⛔ Point the server Lambda at the new zip (version + alias shift).
5. Verify: `GET /api/health` returns `{ ok: true, mode: "real" }`; smoke the sign-in page.
6. Record cold-start p50/p95 after the FIRST staging deploy in `docs/build-notes.md`, and size the
   function from the measurement rather than from a guess. It is not a cutover row — nothing is gated on
   it — but it is the number every later performance question starts from.

## Rollback

Lambda alias back to the previous version (assets are content-hashed, no rollback needed). Migrations
are expand-only by convention — never destructive in the same release as the code that stops using a
column.

## Local rehearsal (works today)

```sh
pnpm build:demo && pnpm start:demo   # the same standalone artifact, fake adapters, demo badge
curl "localhost:$(node scripts/print-port.mjs showcase)/api/health"
```
