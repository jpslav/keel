## What

<!-- one paragraph: what changes and why -->

## Checklist

- [ ] `pnpm verify` green (typecheck, lint, unit, e2e, static demo)
- [ ] `pnpm test:contract` green if migrations/db code changed
- [ ] New strings in BOTH `messages/en.json` and `messages/es.json`
- [ ] Vendor SDK imports only under `packages/keel/src/adapters/` (lint enforces, but say so if you added one)
- [ ] Anything needing real credentials got a `docs/cutover-checklist.md` row + `AUTHORED — CUTOVER` marker
- [ ] Lessons worth keeping → `docs/build-notes.md`; unplanned decisions → `docs/decision-log.md`
