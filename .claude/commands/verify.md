---
description: Run the full verification gate (typecheck, lint, unit, e2e) and fix what fails
---

Run `pnpm verify`. If anything fails, fix it and re-run until green. If Playwright complains about a missing
browser, run `pnpm exec playwright install chromium` once, then retry. Report what failed and what you
changed.

`pnpm verify` does NOT run `test:contract` (the real-Postgres RLS proofs). **If you touched a migration or
any `packages/keel/src/db`/`apps/showcase/src/app-config/db` change, also run `pnpm test:contract`** — and after renumbering/renaming a
migration, wipe local `.data` first (`rm -rf .data`).
