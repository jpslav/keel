# Adopting this template

Adoption is one command:

```sh
pnpm install                                # boots hermetically: no docker, no credentials, no network
pnpm init-app acme --name "Acme Research"   # rename the app you keep; --dry-run previews it
pnpm install && pnpm verify                 # the workspace changed; prove it still holds
```

Commit `pnpm-lock.yaml` with the rest. That middle line changes the workspace, so the lockfile
changes too — and CI installs with `--frozen-lockfile` by default, so a commit that leaves it behind
fails your first push with an error that never mentions `init-app`.

That middle line renames the app you keep and repoints every file that named it. What it deliberately
leaves for you — deployment params, seed data, cutover rows — it prints when it finishes.

Adding `--eject-showcase` also deletes the demo app, and the gate stays green when you do — keel's own
tests run against keel's own fixture seam (`packages/keel/test-fixture`), not against the demo's world.
**Still do it last**: the showcase is the worked example you will read most in week one. Build your
first slices with it present; drop it when you stop reading it.

The rest of this document is what that command does not do: which parts of the tree are yours, how
your product extends the framework, and the discipline that keeps the whole thing honest.

## What is here

Three kinds of thing live in this repo (see
[ADR-0012](adr/0012-framework-app-line-and-registration.md) for the full line):

- **The framework** (**keel**): the workspace package `packages/keel`, imported as `keel/...` —
  ports/adapters, RLS tenancy, authz, jobs/schedules, webhooks in and out, notifications,
  agreements/gates, the Simulator dev/demo harness, its screens and its half of the i18n catalog. You
  extend it; you don't edit it. (Its route wrappers necessarily stay in an app's `apps/<app>/src/app` — Next.js
  requires it.)
- **Two example apps.** `apps/showcase` — a support desk: tickets, escalations, attachments, two job kinds, two
  actors, six people — exists so every framework capability has a living worked example. Read it as
  the reference, then eject it. `apps/starter` — one entity, one card, two tenants, and a seam whose
  other eleven modules register nothing — is **the one you keep**. It is also the framework's second
  consumer, which is what makes the framework/app line falsifiable rather than merely asserted:
  anything keel reaches for that only exists because the showcase supplies it fails to compile there.
- **The repo scaffold**: the verify gate, lint fences, CI, docs doctrine, infra draft. You keep it.

Apps live under `apps/` — one per product, each with its own `package.json`, configs and tests
(ADR-0007). Root commands that operate on ALL apps (`pnpm verify`, `pnpm typecheck`, `pnpm lint`,
`pnpm test:unit`, `pnpm test:e2e`, `pnpm build`, the demo-static trio) fan out with
`pnpm --filter './apps/*'`, so they pick up an added or renamed app with no edit. The commands that
must pick ONE app (`pnpm dev`, `pnpm start`, and the showcase-only `pnpm ladle`, `pnpm build:demo`,
`pnpm dev:real`, `pnpm llm:record`) name an app, and `init-app` repoints or removes them for you.

## Fork and first boot

1. Fork/clone. **Take it with `git clone` or GitHub's Fork — not "Use this template" and not a ZIP**,
   because both of those give you a repository with no commit in common with keel, and
   `git merge upstream/main` then fails with `fatal: refusing to merge unrelated histories`. Updates
   here arrive by merge rather than by a version bump ([ADR-0013](adr/0013-upstream-updates-fork-and-merge.md)),
   so shared history is the mechanism, not a detail. If you already started from a template copy, you
   are not stuck — `git merge --allow-unrelated-histories upstream/main` once will graft the histories
   together and later merges behave normally, but that first one resolves as though every file were
   conflicting, so it is much cheaper to clone.
   Then `pnpm install && pnpm dev` — the app must boot seeded and offline in under two minutes.
   That hermetic boot is the repo's standing acceptance test; if it ever breaks, fix that first.
2. Run the demo tour ([runbooks/demo.md](runbooks/demo.md)) once. Fifteen minutes here saves days
   later: every capability you inherit is shown working, and Simulator is how you'll drive your own app
   in dev.
3. Then run `pnpm init-app`.

## `pnpm init-app`

```
pnpm init-app <slug> [options]        rename the app you keep
pnpm init-app --eject-showcase        delete the demo app (slug optional; both can run at once)

  <slug>              the new APP_SLUG: lowercase letters, digits and dashes. Also becomes the app's
                      directory name and package name (the workspace root becomes <slug>-workspace,
                      so `pnpm --filter <slug>` can only ever mean the app).
  --name "<Name>"     display name for UI copy and titles (default: title-cased <slug>)
  --app <dir>         which directory under apps/ to rename (default: starter, else the only app)
  --eject-showcase    remove apps/showcase and every reference to it
  --dry-run           print the plan and change nothing
  --yes               skip the confirmation prompt (required when stdin is not a terminal)
```

It refuses to touch anything without a `y` at the prompt, or an explicit `--yes`; `--dry-run` prints
the identical plan and writes nothing. It is **idempotent** — every edit replaces the value it found
in the tree rather than a value hard-coded in the script, so re-running it is a no-op, and it works
just as well on an app you already renamed once.

### The identity surface it covers

`APP_SLUG` (in the app's `apps/<app>/config/app.ts`) is the single source of MECHANICAL identity — session and
viewpoint cookies, the fake-auth JWT issuer, the service-token audience, webhook header names, CDK
stack/DB/budget/tags all derive from it. Other identifiers are deliberately NEUTRAL and never need
renaming (`APP_DATA_DIR`, the `app-simulator-*` browser keys, the `@app/*` workspace scope, and the
dev-server port key — see below). What is left is display copy, package naming, and the handful of
files that name the app's directory:

| Where                                                                                  | What                                                                             |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `apps/<app>/config/app.ts`                                                             | `APP_SLUG`                                                                       |
| `apps/<app>/package.json`                                                              | package `name` + `description`                                                   |
| `apps/<app>/messages/en.json` + `es.json`                                              | `welcome.appName` (the header prop) and the `welcome.title`                      |
| `apps/<app>/src/app/[locale]/layout.tsx`                                               | the document `metadata.title`                                                    |
| `apps/<app>/src/demo-static/index.html`                                                | the static demo's `<title>`                                                      |
| `package.json` (root)                                                                  | `name` (`<slug>-workspace`), `description`, `--filter` scripts                   |
| `knip.json`, `vitest.config.ts`                                                        | the workspace key; the app list (`APPS`)                                         |
| `vitest.contract.config.ts`, `tsconfig.json`, `infra/*.ts`                             | the single app each one names                                                    |
| `apps/<app>/` itself                                                                   | the directory, renamed last                                                      |
| `docs/`, `.claude/`, README, CLAUDE, CONTRIBUTING                                      | every backticked `apps/<app>/…` citation the path gate checks                    |
| `CODEOWNERS`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/config.yml`, `CODE_OF_CONDUCT.md` | the maintainer's GitHub handle and the advisory URL → `PLACEHOLDER_GITHUB_OWNER` |

**The last row runs even on a rename-only adoption, with no `--eject-showcase`.** Those four files
route YOUR users to the TEMPLATE maintainer — a security report, a code-owner review, a conduct
complaint — and that is wrong the moment you fork, not only once you delete the showcase. `init-app`
rewrites `@jpslav` and every `github.com/jpslav/keel` advisory link to `PLACEHOLDER_GITHUB_OWNER`, and
prints a "WHAT NOW NEEDS YOUR DETAILS" section naming exactly what to fill in. Left as
`PLACEHOLDER_GITHUB_OWNER`, `CODEOWNERS` names an account GitHub cannot resolve, and turning on
"require review from Code Owners" branch protection makes every PR unmergeable. `LICENSE` and the
`docs/adr/` approver lines are the two places the maintainer's name correctly survives — the first
because MIT requires the notice, the second because it is honest provenance for keel's own decisions.

Filling in the owner is necessary and not sufficient: **two of those links depend on repository
settings that are off by default.** `/security/advisories/new` resolves for a non-maintainer only once
**private vulnerability reporting** is on (Settings → Code security), and `/discussions` 404s until
**Discussions** is enabled (Settings → General → Features). Leave the first off and your security
policy names a private channel that does not exist, so the only route left is the public issue you
just told people not to open. Turn both on when you push, or delete the links you are not going to
honour.

The framework catalog holds NO product name at all: one shared catalog cannot name two products, so
`AppHeader` and `DemoShell` take a **required** `appName` prop and each app passes its own from its
`welcome.appName` key. That key is what `init-app` writes. It is required rather than optional because
the optional version shipped a bug: keel's catalog carried a `shell.appName` fallback, the showcase never
passed the prop, and every signed-in header in the demo rendered the fallback while the product called
itself Northwind Support. Nothing failed, because a default that resolves looks exactly like a default
that is right — and `react/jsx-no-literals`, the one rule that would have caught a raw string, cannot see
a translated key that is merely the wrong one.

**The port key keeps its old name, on purpose.** After `pnpm init-app acme`, the renamed app's
`package.json` still runs `print-port.mjs starter`, its `playwright.config.ts` still calls
`originFor('starter')`, and the override is still `STARTER_PORT`. That reads oddly and is correct: the
keys in `scripts/ports.mjs` name a dev-server SLOT, not an app, and the package script that starts the
server and the Playwright config that points at it agree only because both spell the same literal. A
per-adopter rename would add two more files to the rewrite surface for no functional gain, and a
half-applied one produces two servers on two ports — silent wrong-app adoption, the exact failure that
whole module exists to prevent. Read `starter` as "the second slot", or set `STARTER_PORT` and forget it.

Nothing in that table is a literal an adopter has to hunt for, and no test hard-codes the product's
name: `apps/*/tests/catalog.ts` reads the app's own catalog and the specs assert against that. A rename
cannot break the gate.

### What `init-app` does NOT do

It prints this list when it finishes, because these are the parts that take judgement:

- **Deployment parameters** — `apps/<app>/config/params.ts` (you get one when you eject the showcase).
  Every `PLACEHOLDER_` value, and `sentry.org`. Each maps to a cutover row.
- **The starter's content** — its seed world, its welcome copy, its one entity and its static-demo
  wiring are all still there and all still on screen. `init-app` renamed the app around them. The next
  section lists each one and what to do about it.
- **The cutover checklist** — [cutover-checklist.md](cutover-checklist.md) is yours: owners, dates, and
  the proof each row owes.
- **The licence** — this template is MIT, which means the product you build on it is yours with no
  copyleft obligation. Your own product's licence is still a decision you make; nothing here makes it
  for you.
- **Prose.** `init-app` repoints path citations so the doc gate stays green, but the sentences around
  them still describe a template with two example apps. It prints the list of files to reread; README
  and `CLAUDE.md` are the two that matter, and `CLAUDE.md` is what teaches agent sessions your rules.

### The starter's content is still wired into your UI

A rename changes what the app is called, not what it shows. After `init-app`, four pieces of the
starter are still reachable by anyone who opens your app or your static demo:

| What survives                                    | Where it lives                                                                                                                                                                                                                                                     | Where it shows                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| The seed world: two tenants, two teams, 3 people | `apps/<app>/src/seed/index.ts`                                                                                                                                                                                                                                     | every sign-in picker (the app's, the static demo's, the Simulator's People tab); tenant themes |
| The welcome subtitle                             | `welcome.subtitle` in `apps/<app>/messages/en.json` + `es.json`                                                                                                                                                                                                    | the app's root page AND the static demo's first screen — they share one component              |
| The Items slice                                  | `apps/<app>/src/components/items-card.tsx`, `apps/<app>/src/app/api/items/route.ts`, the `Item` case in `apps/<app>/src/app-config/abilities.ts`, the table, migration and RLS proof under `apps/<app>/src/app-config/db/`, the `items` namespace in both catalogs | every signed-in person's dashboard                                                             |
| The static demo's composition root               | `apps/<app>/src/demo-static/app.tsx`                                                                                                                                                                                                                               | the whole `file://` demo: it passes `nav={null}`, the starter's welcome screen and Items card  |

None of it fails a gate, which is why it is listed here: a real adopter shipped a product demo that
opened on the starter's tenants and its Items card, four days after adopting, because every page that
could have shown them was reached by somebody signed into the product's own world.

**Replace it; do not build beside it.** The seed world is one world, and the framework's pickers list
all of it — `keel/seed/contracts` has no notion of a person who exists but is not offered. A product
world added NEXT TO `northwind` and `westgate` therefore puts both on every sign-in screen. Nothing in
`packages/keel` needs the starter's names: keel's own tests run against `packages/keel/test-fixture`.
What does read them by literal id is yours to change in the same commit:

- `apps/<app>/tests/e2e/items.spec.ts` and `apps/<app>/tests/demo-static/static-shell.spec.ts` sign in
  as `person-owner`, `person-teammate` and `person-other-tenant`, and assert the tenant names.
- `staffOrgSlug` in `apps/<app>/src/app-config/abilities.ts` must name a real seed org.

What the seed must keep is its SHAPE, not its content: the exports `keel/seed/contracts` types, at
least one person to sign in as, and two tenants for as long as you want tenant isolation to be
something a test can observe. WHERE it lives is yours.

**The Items slice is a worked example, so take what it teaches before you delete it.**
`apps/<app>/src/app-config/db/migrations/1001_items.ts` is the RLS pattern every new tenant table copies, and its
section of `apps/<app>/src/app-config/db/rls-proofs.ts` is the proof that goes with it. Build your first real slice
from them (`/new-slice`), then remove Items the way "To remove a demo slice" below describes. There is
no flag that does this for you yet; `.claude/future-tasks/init-app-blank-option.md` carries the design.

**Wire the static demo last, and look at it.** A shell or a home screen you build in
`apps/<app>/src/components` reaches the real app through its route files and reaches the static demo
ONLY through `apps/<app>/src/demo-static/app.tsx` — the `nav`, `welcome` and `dashboard` props it hands
`DemoShell`. Being router-agnostic makes a component ABLE to run in the twin; it does not put it there.
When the sweep is done, run `pnpm build:demo-static`, open the file, and sign in as each seeded person.
That one look is the check: the picker, the first screen and the dashboard are exactly the three places
the starter survives.

### What ejecting the showcase costs, and what it rescues

Two things inside `apps/showcase` are not the demo, and `--eject-showcase` moves them into your app
before deleting the directory: the **RLS contract harness** (`apps/<app>/tests/contract/`, which runs keel's
composed proof suite against real Postgres — the anti-drift gate CI depends on) and
**`apps/<app>/config/params.ts`**. Deleting the directory around them would have quietly deleted a gate.

Five root scripts are dropped, because the starter does not ship the capabilities behind them:
`dev:real`, `llm:record`, `ladle`, `build:demo`, `start:demo`. They come back with the thing they
drive — a Sentry/params-wired `next.config.ts` and a real-mode preflight for `dev:real`, an
`@app-config/assistant` registration for `llm:record`, `@ladle/react` plus a `.ladle/` config for the
workshop, Panda codegen for the demo build. Copy each from the showcase **before** you eject if you
want it.

One gate is relaxed on the way out. keel's knip workspace carries `includeEntryExports: true`, which
means "every symbol keel PUBLISHES must have a consumer" — an invariant the showcase made true by using
nearly all of it. A one-entity app does not: `apps/starter` imports 30 of keel's 126 published subpaths,
so the same setting would start demanding you delete the other 96 — capabilities you merely have not
reached yet, not dead code. `--eject-showcase` therefore turns it off. knip keeps reporting unused
files, and the declared `exports` surface goes back to being what it is without a rich consumer: a
declaration.

**What ejecting does NOT cost you is the gate.** keel's own suite used to be welded to the demo's
vocabulary — its seed slugs, its `tickets` table, its `export-tickets` job kind, its route tree — so
deleting the demo took `pnpm test:unit` and `pnpm typecheck` down with it. The framework now carries a
seam of its own, `packages/keel/test-fixture`: a conforming `@app-config/*` registration with its own
two-tenant seed world, one table and migration, one job/webhook/notification kind, an inbound handler,
and a route tree that exists only to be read by the authorization scan. The root TypeScript program
resolves `@app-config/*` there, and `vitest.config.ts` runs keel's suite in a `keel` project pointed at
it. Nothing in that fixture is deletable by adoption, and its vocabulary is deliberately none of the
apps' — so a framework test that reacquires a dependency on YOUR world fails loudly instead of passing
by coincidence. `pnpm verify` is green on a freshly ejected repo, end to end.

The one thing that DOES stay app-shaped is the seam-conformance pair — the i18n partition/parity tests
and the pglite RLS suite — which keep running under every app's own vitest project, against your
catalog and your tables. That is what stops the fixture becoming the only world the framework is ever
proved against.

## Layout

```
packages/keel/src/            the framework — never edit for product work
packages/keel/test-fixture/   the framework's OWN app seam, for its OWN tests — not yours, not shipped
apps/<app>/config/            APP_SLUG and (optionally) deployment params
apps/<app>/src/app/           Next route files (thin wrappers; framework routes live here too)
apps/<app>/src/app-config/    THE SEAM — your registrations
apps/<app>/src/components/    your screens/cards
apps/<app>/src/domain/        your domain modules
apps/<app>/src/demo-static/   your half of the file:// demo twin (the framework half is keel's)
apps/<app>/src/seed/          your seed world (fills in keel/seed/contracts)
apps/<app>/messages/          your i18n namespaces (the framework ships its own catalog)
apps/<app>/tests/             your e2e, static-demo and contract specs
```

### What you may import from keel

`packages/keel/package.json`'s `exports` map is the contract: it lists the 126 subpaths your app may
import as `keel/<subpath>` (`keel/ports/db`, `keel/components/app-header`, `keel/db/with-tenant`). The
other 34 modules of the package are internals — private sub-components, the fake-db plumbing, the
framework migrations, the real adapters the registry constructs for you — and importing one fails
`pnpm lint` with the rule `keel/public-surface`, which reads that map directly. If you find yourself
reaching for an internal, that is a signal the capability needs a seam, not a wider fence; if a module
really is part of the contract and merely has no importer yet, promote it by adding one line to the map.

Two call sites reach keel by file path instead of by subpath, because their tools need a file rather
than a module specifier, and they are the two to remember if you move things: each app's
`next.config.ts` points next-intl at `packages/keel/src/i18n/request.ts`, and `infra/stack.ts` bundles
the migrator Lambda from `packages/keel/src/adapters/real/migrate-handler.ts`. Nothing typechecks
`infra/`.

## Building your product — everything registers through `apps/<app>/src/app-config/`

The framework never imports your code directly; it imports the registration seam (`@app-config/*`), and
a lint fence enforces the direction. Each module there is the app-side half of one capability. The
"empty" column is what `apps/starter` registers — read it as the off switch for that capability:

| Seam module                                   | You register                                           | Empty looks like              |
| --------------------------------------------- | ------------------------------------------------------ | ----------------------------- |
| `abilities.ts`                                | your subject types + authorization rules + staff org   | (starter registers one)       |
| `db/schema.ts`, `db/migrations/`              | your tables (`AppTables`) + migrations numbered ≥ 1001 | (starter registers one)       |
| `db/rls-proofs.ts`                            | tenant-isolation proofs for those tables               | an empty async body           |
| `jobs.ts`                                     | your background job kinds + handlers                   | `[] as const`, `{}`           |
| `digest.ts`                                   | the rows the framework's scheduled digest summarizes   | `async () => []`              |
| `actors.ts`                                   | your simulated counterparties for dev/demo             | `type ActorId = never`        |
| `simulator.ts`                                | your extra Simulator tabs + feature flags              | `flags = []`                  |
| `tours.ts`                                    | scripted Simulator walkthroughs of your product        | `tours = []` (no Tours tab)   |
| `notifications.ts`, `webhooks.ts`, `audit.ts` | your event vocabularies                                | `[] as const` / `never`       |
| `inbound-email.ts`                            | your `<org>+<slug>@domain` email handlers              | `{}`                          |
| `assistant.ts`                                | your LLM tools + system prompt                         | omit the module and its route |
| `messages.ts`                                 | your i18n namespaces + catalog loader (partitioned)    | (every app registers some)    |
| `identity.ts`                                 | `APP_SLUG`, re-exported from the app's app config      | (every app registers it)      |
| `seed.ts`                                     | your seed data re-export                               | (every app registers it)      |

The one place an empty registration is not free: `AppSubjectFields` in `abilities.ts` must be an
`interface` (the framework's `AbilitySubject` extends it), and an app with no extra subject fields
therefore declares an empty one and suppresses `@typescript-eslint/no-empty-object-type` on that line.
`apps/starter` shows the suppression and why.

**To add a feature slice**: run `/new-slice` (and the per-capability scaffolds `/new-entity`,
`/new-job`, `/new-actor`, `/new-notification-kind`, `/new-webhook-event`, `/new-tour`). Each walks the house way:
screen in your app's `apps/<app>/src/components` (yours) or `packages/keel/src/components` (framework-generic),
thin route, seam registrations, an RLS migration copied from the reference
(`apps/starter/src/app-config/db/migrations/1001_items.ts`), colocated tests, e2e, then `pnpm verify` +
`pnpm test:contract`.

**To remove a demo slice** (if you keep the showcase around for a while): delete its card + routes +
`apps/<app>/src/domain/` module + seam entries (ability case, table, migration, message namespace, vocabulary
entries) and its e2e specs, then update the static twin (`apps/<app>/src/demo-static/app.tsx`) and run the full
gate. Tickets is the most-wired example (assistant tool, export job, inbound handler all reference it)
— replace those seam entries together. An unused framework capability needs nothing: an empty
registration is the off switch.

**Static demo parity**: every slice ships its in-memory twin so the single-file `file://` demo keeps
walking end-to-end. You only write your DOMAIN half — `apps/<app>/src/demo-static/app.tsx` is a
composition root that adds your rows and cards to the framework world `keel/demo-static` already
simulates (people, mail, jobs, schedules, webhooks, notifications, agreements, audit, snapshots). For one
table that is 74 lines; the showcase's, with three entities plus actors and the assistant, is 669.
Budget-gated per app (`pnpm check:demo-size`, each app passing its own byte budget). The same file is
the ONLY door for your shell, too: the `nav`, `welcome` and `dashboard` it passes `DemoShell` are what
the demo shows, so a navigation you build for the real app is absent from the twin until you pass it
there.

**How a second app keeps the seam honest**: `apps/starter/tsconfig.json` includes the whole of
`packages/keel/src` (minus tests and stories), so `pnpm typecheck` compiles the ENTIRE framework
against the starter's registrations — a framework module that assumed the showcase's tables or
vocabulary fails there and nowhere else. `vitest.config.ts` then runs keel's seam-conformance tests
(the i18n partition/parity pair and the composed pglite RLS suite) a second time under the starter's
aliases. Both were watched failing before being trusted.

## Cutover — from hermetic to real

Everything needing credentials, accounts or money is a row in
[cutover-checklist.md](cutover-checklist.md) — **that file is yours**, pre-filled with the rows
essentially every instance needs and waiting for your owners and dates. The pattern:

> **Row** = item name · what it is · what unlocks it · the exact verification that was deferred.

The last column is the one that matters. Until a row's proof is met, the related real adapter is
_authored but unverified_ — it compiles, it has a fake that everything else runs on, and nobody has ever
watched it talk to the real thing. Keep the discipline when you add rows: **name the proof, not just the
task.** "Set up email" is a task; "a real send through the email port with DKIM/SPF verified on the
domain" is a proof.

The file opens with a worked row — closed, dated, owned, with a proof column that was thought through
rather than restated. Read it once for the level of detail each row deserves before you fill in your own.

## Staying current with keel

Adopting is a fork, not a dependency: keel ships as a workspace package inside the repo you took, so
upstream improvements reach you through `git merge`, not `pnpm update`.
[ADR-0013](adr/0013-upstream-updates-fork-and-merge.md) records why, and the exact
`git remote add upstream` workflow — including which directories reliably conflict and what would make
publishing to a registry worth the versioning cost.

## Keeping the docs honest

The doc set is mapped in [docs/README.md](README.md), which splits it three ways: doctrine (binding, and
**gated** — `tests/docs/doc-paths.test.ts` fails the build if a doctrine doc cites a path that does not
exist), dated records, and future tasks. Two consequences for you on day one:

- **The records (`docs/decision-log.md`, `docs/build-notes.md`) are the template's, not yours.** They are
  append-only, so nothing rewrites them; keep appending your own entries below the inherited ones, or
  truncate them at the date you forked and keep the habit. `build-notes.md` in particular earns its keep
  the first time something behaves strangely.
- **`.claude/future-tasks/`** carries designed-but-unbuilt work with the design written down. Keep the
  ones you want, delete the rest.

The habits that keep the rest truthful, which you inherit: record unplanned decisions in
`decision-log.md` and hard-won lessons in `build-notes.md` as they happen; amend an ADR by appending a
dated addendum, never by editing what it said; run the `doc-steward` agent on every branch diff before a
PR; `/pre-pr` runs the verify gate plus a branch review. `CLAUDE.md` teaches all of this to agent
sessions — keep it current as your product diverges.
