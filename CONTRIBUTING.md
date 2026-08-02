# Contributing

Read `docs/adr/` first — all thirteen decisions are Accepted and not relitigated in routine work. `CLAUDE.md` is
the same rulebook in agent-sized form.

## Before you build a capability: it may be a recipe, not a feature

**This template deliberately ships less than it could, and the most expensive contribution here is the
one that was never going to be accepted.** Read **"What the template ships"** in
`docs/development-approach.md` before you write code. It defines the tests, and they are decidable
before you start:

- **Universality** — will every instance built on this use it?
- **New class** — does it demonstrate integration mechanics the template does not already teach?
- **Framework invariant (UI)** — does the component encode a rule, or is it generic presentation?

Vendor code must pass at least one of the first two; a UI component is judged by the third. Something
that fails is not rejected as an idea — it goes into `docs/recipes/` as a written plan, so the pattern
is recorded without the maintenance bill. `docs/recipes/sms-twilio.md` and `web-push.md` are worked
rejections of vendor adapters, and `list-kit.md` of a component; read one to see what the bar looks
like in practice. A well-argued "this should stay a recipe" is as useful a contribution as a feature.

Open a **Capability request** issue and get agreement before building. The four steps under "Adding an
adapter" below are how you implement one that has passed — not a green light on its own.

## Sending a change

- Branch, commit, open a PR against `main`. Every PR runs the full CI suite (`.github/workflows/checks.yml`).
- `pnpm verify` is the local gate and must be green before you push. It does **not** run everything CI
  does: `pnpm test:contract`, `pnpm jscpd`, `pnpm test:coverage` and the secret scan are CI-only, so run
  `pnpm test:contract` yourself for any migration or database change.
- **Adopters sending a fix upstream:** branch off `upstream/main`, not your fork's `main`, and send only
  the `packages/keel` change — see `docs/adr/0013-upstream-updates-fork-and-merge.md`, which explains
  why a keel change carried locally in a fork is a permanent merge-conflict generator.

## The ports rule (the one rule that matters most)

Vendor SDKs (`@clerk/*`, `@aws-sdk/*`, `@anthropic-ai/*`, `@sentry/*`, `posthog-*`, `mailgun.js`, `pg`)
may only be imported inside `packages/keel/src/adapters/`. Everything else codes against the
interfaces in `keel/ports/`. The lint rule that enforces this is load-bearing; if you hit it,
you're about to couple the app to a vendor — add to the port instead. (Ports and adapters are framework
code: they live in the `keel` workspace package — ADR-0012.)

**Adding an adapter** for an existing port — once it has passed one of the two tests above:

1. Implement the interface from `packages/keel/src/ports/<port>.ts` in
   `packages/keel/src/adapters/<real|fake>/<name>.ts`.
2. Fakes must be honest: persist under `.data/` (`dataDir()` helper) or in memory, behave like the real
   thing at the port surface, and stay offline.
3. Real adapters that need credentials get: an env var registered in
   `packages/keel/src/adapters/real/index.ts`
   (`REQUIRED_ENV` — this powers `dev:real`'s fail-fast), a row in `docs/cutover-checklist.md`, and an
   `AUTHORED — CUTOVER` header comment until integration-verified.
4. Wire it in the registry (`packages/keel/src/adapters/index.ts`), add unit tests for the fake,
   and extend the e2e
   flow if user-visible.

**Adding a port**: only when the app needs a new capability — size the interface to the app's need,
never to a vendor's API. `/new-port` (Claude command) scaffolds the layout.

## Everyday conventions

- Formatting is `.editorconfig` + Prettier — run `pnpm lint:fix`, never hand-format.
- Conventional commits, lowercase subject, ≤100 chars (commitlint hook enforces).
- UI strings go through next-intl; the lint rule catches literals. The catalog is split along the
  framework/app line — framework copy in `packages/keel/src/i18n/messages/*.json`, app copy in
  `apps/showcase/messages/*.json`, deep-merged at load.
- Screens are router-agnostic (props in, callbacks out; no Next imports) — framework ones in
  `packages/keel/src/components`, app ones in `apps/showcase/src/components`; route files under `apps/showcase/src/app` are
  thin wrappers plus fetch-glue.
- Tenant-scoped data access only through `db.withTenant()` — `getDb()` is banned in request paths
  (lint-enforced), and every tenant table carries the RLS policy pattern from
  `apps/showcase/src/app-config/db/migrations/1001_tickets.ts`.
- New migrations: app tables go under `apps/showcase/src/app-config/db/migrations/` (numbered ≥ 1001) and extend
  `AppTables`; framework tables go under `packages/keel/src/db/migrations/` (0001–0999). Register
  in the neighbouring `index.ts` either way. The same migration code must pass `pnpm test:unit`
  (pglite) and `pnpm test:contract` (real Postgres).
- Before finishing any change: `pnpm verify`.

## Test layers

| Layer    | Command                | Engine                                                    |
| -------- | ---------------------- | --------------------------------------------------------- |
| unit     | `pnpm test:unit`       | Vitest + happy-dom; db tests on pglite                    |
| e2e      | `pnpm test:e2e`        | Playwright against `pnpm dev` (all fakes)                 |
| contract | `pnpm test:contract`   | Real Postgres (embedded locally, service container in CI) |
| demo     | `pnpm e2e:demo-static` | The built single-file shell from `file://`                |
