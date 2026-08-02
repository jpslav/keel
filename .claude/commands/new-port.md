---
description: Scaffold a new port + fake/real adapters following the house pattern
---

Create a new port named $ARGUMENTS following the established pattern:

1. Read `packages/keel/src/ports/email.ts` and `packages/keel/src/adapters/fake/email.ts` as the reference shape.
2. Write `packages/keel/src/ports/<name>.ts` — a narrow interface sized to what the app needs (ask me what
   operations the app actually requires before writing it; never mirror a vendor API).
3. Write `packages/keel/src/adapters/fake/<name>.ts` — honest fake persisting under `.data/` via `dataDir()` or in
   memory; fully offline.
4. Write `packages/keel/src/adapters/real/<name>.ts` — mark `AUTHORED — CUTOVER (<row>)` in the header, register any
   required env vars in `packages/keel/src/adapters/real/index.ts` REQUIRED_ENV, and add the cutover-checklist row.
5. Wire both into `packages/keel/src/adapters/index.ts`, add the vendor's package pattern to `vendorSdkPattern` in
   `eslint.config.mjs`, add unit tests for the fake, and run `pnpm verify`.
