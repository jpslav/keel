# ADR-0007 — Repo shape: pnpm monorepo with an `apps/` tree

- Status: Accepted
- Approver: JP Slavinsky
- Date: 2026-08-01

## Context

The natural shape for a single product is the Next app at the repo root with a few support packages
beside it: no `apps/` indirection, no `--filter` on every command, nothing to explain. For a product,
that is still the right answer.

This repo is not a product. It is a template whose central claim is that the generic machinery
(`packages/keel`) is separable from the product built on it, and that apps extend it only through a
registration seam (ADR-0012). A claim like that is either checked or it is decoration, and the only thing
that checks it is a **second consumer**: a framework module that quietly assumed one app's tables, seed
slugs or vocabulary compiles perfectly against that app and fails against any other.

With the app at the root, a second app could only ever be a special case — a subdirectory with different
rules, different commands, and a standing temptation to treat "the" app as normal and the other as a
test. A symmetric tree makes it a sibling, and makes "which app is this command about?" a question with a
real answer instead of an assumption.

## Decision

**A pnpm workspace with an `apps/` tree.** The repo carries:

```
apps/showcase          the demo — every framework capability, worked
apps/starter           the minimum an adopter keeps, and the framework's falsifier
packages/keel          the framework (ADR-0012)
packages/seed          the showcase's seed world, consumed by the app and by the browser fakes
infra/                 the CDK draft (ADR-0001)
spikes/*               committed proof harnesses
```

Each app is self-contained: its own `package.json`, `config/` (holding `APP_SLUG` and, optionally,
deployment params), `messages/`, `src/`, its build configs (`next.config.ts`, the Playwright configs, the
demo vite build) and its test trees (`tests/e2e/`, `tests/demo-static/`), with a `tsconfig.json`
extending the root one. Build outputs (`.next/`, `.data/`, `dist-demo/`, `playwright-report/`) follow the
app. Apps are not required to be identical: `apps/showcase` additionally carries a Panda config, a Sentry
wrapper and the RLS contract harness (`tests/contract/`), and `apps/starter` deliberately carries none of
them — which is itself part of what the second app proves, since the framework must work for an app that
has not turned those on.

**What stays at the root**: `packages/`, `infra/`, `docs/`, `scripts/`, `spikes/`, the lint/format/dup
configs, both vitest configs, and `tests/` — which holds repo-hygiene gates (the doc-path gate, the
port-derivation proofs), not app tests. The root vitest project runs `tests/**` deliberately alias-free,
so nothing there can depend on one app being "the" app.

**Root commands mean what they say.** Commands that operate on ALL apps fan out with
`pnpm --filter './apps/*'` — `build`, `typecheck`, `test:e2e`, the demo-static trio — so they pick up an
added or renamed app with no edit. Commands that must pick ONE app name it (`dev`, `start`, and the
showcase-only `ladle`, `build:demo`, `dev:real`, `llm:record`), and `pnpm init-app` repoints or removes
them. `pnpm verify` from the repo root still means what it always meant.

**App identity is concentrated in single literals.** `vitest.config.ts` names its app list in `APPS`;
`vitest.contract.config.ts` names `CONTRACT_APP`; the root `tsconfig.json` and `infra/*.ts` each name one
app in one place. That is not tidiness — it is what makes `pnpm init-app` a one-line edit per file rather
than string surgery, and what makes an upstream merge into an adopted fork a five-second conflict rather
than a scattered one (ADR-0013).

**The workspace root package is `<slug>-workspace`, never the app's slug.** Giving both the same name
makes `pnpm --filter <slug> test:e2e` match the root as well as the app; the root script then fans out to
every app, and two dev servers race for one port.

### This does not weaken the one-app default

`docs/development-approach.md` says: prefer one app, one repo, one pipeline, for longer than intuition
suggests. That doctrine governs **decomposing a product into services** — it is about resisting a second
_deployable_, with its own pipeline, its own failure modes and its own hermetic-dev problem. It says
nothing about a template carrying example consumers, and this ADR does not soften it.

The test is whether the second directory is a second _product_. `apps/starter` is not deployed, has no
pipeline of its own, shares one verify gate, and exists to be compiled. An adopter ends up with exactly
one app: `pnpm init-app <slug> --eject-showcase` leaves a single directory under `apps/`, which is the
one-app default in its normal form, reached by a supported command rather than by surgery.

## Consequences

- `pnpm --filter` addresses apps, packages and spikes uniformly; there is no "root app" special case
  left.
- **The framework/app line is checked by the compiler, not only by a lint fence.**
  `apps/starter/tsconfig.json` includes the whole of `packages/keel/src`, so `pnpm typecheck` compiles the
  entire framework against the starter's registrations.
- **The authorization scan generalized.** `authorized-mutations.test.ts` walks `apps/*/src/app/api`, so
  every app is scanned against the same exemption map and an app cannot escape the choke point by
  existing.
- **`config/` is per-app**, because it holds `APP_SLUG` and the deployment params. `infra/` imports one
  app's config; an adopter repoints it.
- **cwd is the app for anything that runs the app, and the repo root for anything that runs the repo.**
  That is fine for `.data/` (already `APP_DATA_DIR`-overridable) but it bit the fake LLM adapter, which
  resolved its fixtures from cwd while being exercised by a root-run suite; it gained the same override
  (`APP_FIXTURES_DIR`). Any new cwd-relative path needs the same treatment.
- Nothing in `infra/` may depend on app source beyond the one config import. It is a tenant of this repo,
  not part of an app, and moving it into a dedicated infrastructure repo stays a one-line change.
- Two apps mean two e2e suites and two demo artifacts on every verify. That is the cost of the falsifier,
  and it is the cheapest place the repo spends time.
