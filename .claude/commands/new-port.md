---
description: Scaffold a new port + fake/real adapters following the house pattern
---

Create a new port named $ARGUMENTS following the established pattern.

**First decide whose port it is, and ask me if it is not obvious.** It is keel's when keel's own code calls
it, or when the vendor passes the universality or new-class test (`docs/development-approach.md`, "What the
template ships"). It is the APP's when only the app calls it and the vendor fails both tests, as with a
CDN key-value store, an e-sign provider, or a domain-specific API. An adopter does not carry keel changes in
a fork (ADR-0013), so in an adopted repo an app's port goes in the app.

## A keel port

1. Read `packages/keel/src/ports/email.ts` and `packages/keel/src/adapters/fake/email.ts` as the reference shape.
2. Write `packages/keel/src/ports/<name>.ts` — a narrow interface sized to what the app needs (ask me what
   operations the app actually requires before writing it; never mirror a vendor API).
3. Write `packages/keel/src/adapters/fake/<name>.ts` — honest fake persisting under `.data/` via `dataDir()` or in
   memory; fully offline.
4. Write `packages/keel/src/adapters/real/<name>.ts` — mark `AUTHORED — CUTOVER (<row>)` in the header, register any
   required env vars in `packages/keel/src/adapters/real/index.ts` REQUIRED_ENV, and add the cutover-checklist row.
5. Wire both into `packages/keel/src/adapters/index.ts`, add the vendor's package pattern to `vendorSdkPattern` in
   `eslint.config.mjs`, add unit tests for the fake, and run `pnpm verify`.

## An app's port

Follow `docs/recipes/app-owned-adapter.md`; it carries the sketches. In short, with `<app>` the app's directory:

1. Write `apps/<app>/src/ports/<name>.ts` — types only, sized the same way (ask me for the operations).
2. Write `apps/<app>/src/adapters/fake/<name>.ts` — offline and honest, state in memory (pinned on
   `globalThis`) or in the app's own tables, never under `.data/`. No vendor SDK and no `process.env`;
   the lint refuses both here.
3. Write `apps/<app>/src/adapters/real/<name>.ts` — the only file that imports the vendor SDK, marked
   `AUTHORED — CUTOVER (<row>)`. Install the SDK in `apps/<app>/package.json`, never keel's. Read
   configuration from `process.env` in `apps/<app>/src/adapters/real/index.ts` with a REQUIRED_ENV map that
   throws `CutoverPendingError` (`keel/ports/errors`); never read `APP_MODE`, `DEMO_MODE` or `E2E_BUILD`.
   Record non-secret params and secret NAMES in `apps/<app>/config/params.ts`, and add the cutover row.
4. Write the registry, `apps/<app>/src/adapters/index.ts`: import `isSimulated` from `keel/adapters/index`,
   `await import('./real/index')` only when it is false, and export each port as `real?.x ?? fakeX`.
5. Callers import the registry (`@/adapters`), never `@/adapters/real/*`. Make sure the vendor's package is
   matched by `vendorSdkPattern` in `eslint.config.mjs`, add unit tests for the fake, and run `pnpm verify`.
