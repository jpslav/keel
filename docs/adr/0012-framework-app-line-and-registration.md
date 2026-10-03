# ADR-0012 — The framework/app line: registration through the app-config seam

- Status: Accepted
- Approver: JP Slavinsky
- Date: 2026-08-01

## Context

This repo is a template: generic machinery — ports and adapters, RLS tenancy, the authorization choke
point, jobs and schedules, service auth, webhooks in and out, notifications, agreements and gates, and
the Simulator harness — built alongside a demo app that exercises every one of them.

That arrangement has a characteristic failure, and it is not the one people expect. The infrastructure
layers stay clean; nobody writes the demo's vocabulary into a database adapter. What the demo welds
itself into are the **shared surfaces**: the `SubjectType` union, the `DB` schema type and migration
registry, the job-kind union and its handler map, the inbound-email handler registry, actor and staff-org
constants tied to seed slugs, the i18n catalogs, the notification and webhook-event vocabularies, and the
dev panel's tab list. Each one is a place where "the framework" and "the app" have to name each other,
and each one silently becomes app-shaped unless something prevents it.

The choice was to make the framework/app line **structurally real inside this repo** rather than to
publish a library. A library boundary is a distribution decision (ADR-0013); what was needed first was a
boundary that a compiler and a lint rule can check.

## Decision

### The line

**Framework** is the workspace package `packages/keel`, imported as `keel/…`: ports, adapters, core,
authz, db (base tables and migrations 0001–0999), i18n, service-auth, inbound-email, server-lib,
observability, email, theme, the framework screens, the framework's half of the message catalog, and the
simulated world (`keel/demo-static/*`).

**An app** is everything under `apps/<app>/src/`: route files (`src/app` — they stay there forever, Next
requires it), the registration seam (`src/app-config`), domain modules, its own cards and screens, its
half of the static-demo twin, its seed world, and its message namespaces.

**Repo scaffold** — configs, CI, docs, `CLAUDE.md`, `infra/` — stays top-level and belongs to neither.

### The seam

**Apps extend the framework only through registration modules in `apps/<app>/src/app-config/`, imported
by framework code as `@app-config/*`.**

A seam module is a plain, directly-imported module whose exports conform to framework-exported contract
types. No dependency injection, no TypeScript module augmentation, no runtime registration calls, no
barrels. That is a deliberate rejection of the usual answers: a DI container makes the wiring dynamic and
therefore unverifiable by the compiler, and module augmentation makes the extension point invisible at
the place it is used.

Framework→seam imports are type-only except for a short **enumerated** list of value imports: the ability
rules and staff org (`abilities`), the migration registry (`db/migrations`), the RLS proofs
(`db/rls-proofs`), the job-kind list and handler map (`jobs`), the notification kinds and copy function
(`notifications`), the webhook event kinds (`webhooks`), the inbound-email handlers (`inbound-email`),
the Simulator flag registry (`simulator`), the registered tours (`tours`), the seed re-export (`seed`),
the digest body source (`digest`), identity (`identity`, i.e. `APP_SLUG`), and the message loader
(`messages`). Everything else — actor ids, subject types, app table shapes — crosses as `import type` and
is erased. The list is short on purpose: each entry is a case where the framework must run app code, and
each was added one at a time with a reason.

### Composed unions

Framework mechanisms that need app vocabulary **compose** it — `X = FrameworkX | AppX` — for subjects,
job kinds, audit actions, notification kinds and webhook event kinds. The migration registry merges the
framework map (0001–0999) with the app's (≥1001). The i18n namespace partition (framework ∪ app, disjoint
and exact) is test-enforced.

**A literal keyed by a composed union is always a leak.** A framework component holding a
`Record<NotificationKind, string>` label map is holding a record over a type that by construction
includes whatever the _app_ registered; it compiles for the app that supplied the keys and for nobody
else. Derive from the union by convention instead of enumerating it. This rule generalizes to every one
of the five composed unions above.

Deny-by-default and choke-point mechanisms — `authorize()`, the mutation scan — stay framework-owned and
uncomposed. An app extends the vocabulary they range over; it never extends the mechanism.

### The fence

ESLint bans the app's `@/*` alias and `@app/seed` inside `packages/keel`; `@app-config/*` is the only
sanctioned door. The same blocks carry the vendor-SDK boundary and the `next/font/google` ban, and the UI
rules (i18n literals, a11y attribute literals, `getDb`, `process.env`) explicitly cover the package's
`components/**` so that moving a screen into the framework never silently drops them.

One trap is worth naming because it has bitten twice: `no-restricted-imports` **merges by key**, so a
later config block silently replaces an earlier one for matching files. Every block that redeclares it
must re-list the shared patterns. That is also why the public-surface rule below is its own rule id
rather than more patterns on that rule.

### The public surface

**`packages/keel/package.json`'s `exports` map is the public surface, and a lint rule enforces it.**

The map names **126 published subpaths**; the other **34 modules are internal**, reachable only by
relative import inside the package. Every entry is an explicit subpath pointing at one file — no
wildcards — so **the default for a new module is private**, which is the property that makes the map
worth having at all. The internals are the fake-db plumbing, the six real adapters the registry
constructs, five private sub-components, the framework migrations and their registry, `db/seed`,
`db/service-keys`, the demo world's private halves, and `i18n/namespaces`.

Two prior states are worth recording, because each looked like a boundary and was not:

- **A wildcard map publishes everything, which declares nothing.** It also blinds knip, because a module
  that is an entry point is never reported for unused exports — so the majority of the framework sat
  outside the dead-code gate.
- **A package boundary that every build tool is configured to skip is not a boundary.** `keel` resolves
  through aliases (tsconfig paths in the root and both apps, both vitest configs, each demo vite build),
  and an alias bypasses Node's `exports` resolution entirely. Even a perfectly narrowed map would have
  been documentation. The general lesson: **when a repo aliases a workspace package to its own source for
  convenience, the package manifest stops being enforcement and needs a lint rule behind it.**

So the enforcement is a local ESLint rule, `keel/public-surface`, which **reads the `exports` map itself**
— there is no second list to drift — and fails any `keel/<subpath>` the map does not publish, in static
imports, `import()`, re-exports, `require()` and `vi.mock()`. It applies repo-wide, because apps, repo
scripts, `infra` and the other workspace packages all resolve `keel/…` through the same alias.

Two measurement lessons from declaring the surface:

- **Usage is evidence of a contract, not the contract itself.** A dozen modules were published with no
  importer — the three ports no app happens to call yet (an adopter swapping an adapter implements
  against exactly those), the pinned model ids, the schedule vocabulary, the gate interstitial whose own
  docblock names its extension, two email templates, the SMS channel seam, the CDK migrator entry and the
  next-intl request config.
- **A surface measurement must follow dynamic `import()` and mock specifiers, not just static imports.**
  `adapters/real/*` turned out not to be registry-only: three of its modules are React client components
  an app route lazily imports by name, and they cannot come through `adapters/index`, which is
  `server-only`.

`includeEntryExports` in knip now means something sharper than it did under the wildcard: the entry
points **are** the declared surface, so it reads as "every symbol you publish must have a consumer."
`ignoreExportsUsedInFile` is limited to `interface`/`type` — public vocabulary a module also uses
internally is a deliberate seam, and functions stay fully checked.

Two call sites reach keel by **file path** rather than by subpath, and are outside the fence by
construction: each app's `next.config.ts` (next-intl's plugin wants a file) and `infra/stack.ts` (CDK
bundling wants a file). Recorded rather than papered over.

### The dependency manifest

`packages/keel` declares its own dependencies. It did not always, and the root manifest was silently
acting as its own — which works until the package moves.

Declaring them exposed a hazard that now constrains how the package may be extended: adding a
React-context library as a plain dependency **forks** it, giving keel a different resolution than the
apps and putting two provider instances in one bundle. The rule: **host-owned singletons (`react`,
`next`, `next-intl`, `@mantine/core`) are `peerDependencies`; everything keel owns outright is a
`dependency`.** Any dependency change is checked by comparing the resolved path of keel's copy against
the app's, not by whether the build passes.

### Unused capability = empty registration

An adopter who does not need a capability **registers nothing**. No scaffolding, no removal surgery. That
holds in every seam module but two, and both exceptions are recorded because they look like bugs:

- **`AppSubjectFields`** must be an `interface` (`AbilitySubject extends` it, and a mapped type cannot be
  extended), so an app with no extra subject fields declares an empty one and suppresses
  `@typescript-eslint/no-empty-object-type`.
- **`appNotificationCopy`** must exist even for an app registering zero kinds, because the framework's
  switch calls it unconditionally from `default:`. With both parameters `never`, returning one is the
  honest body.

There is a third form, for a capability whose honest empty state is _no function at all_: the app seeder.
`keel/db/seed.ts` resolves `@app-config/seed`'s `appSeedRows` by **lookup** rather than by named import,
so an app with no product corpus simply does not export it. The framework is the party that tolerates the
absence. (It is a lookup and not a boot hook because product rows must survive a Simulator world reset,
which wipes `.data/` and re-runs only the framework seeder.)

**A framework value that can only ever be correct for one consumer must not have a default.** The header
product name shipped as an optional prop with a fallback in keel's catalog; nothing failed, and every
signed-in header rendered the wrong product. **A default that resolves is indistinguishable from a
default that is right** — and no lint rule can see a translated key that is merely the wrong one. Make
the seam required so the compiler asks the question.

### App copy lives in the app's catalog

Where a framework subsystem renders app-registered vocabulary, the framework declares a **copy contract**
and the app satisfies it in its own catalog. `notificationCopy` stamps a namespace on what it returns —
`notifications` for framework kinds, `appNotifications` for app kinds — and every renderer resolves
`${namespace}.${key}`. Simulator actor cards carry title/description **strings** rather than keys, and an
app-registered flag's label is a fully-qualified `namespace.key`. The alternative, which shipped first
and was wrong, was app strings sitting in the framework's catalog: permitted by the namespace-partition
test, forbidden by this ADR.

### The simulated world belongs to the framework

Almost everything the static-demo twin re-implements in memory is framework machinery — notifications and
prefs, webhooks in and out, agreements, jobs and schedules, inbound email, audit, analytics, flags,
invites, SMS, the people/mail/continuity model, snapshots. A second app would otherwise write all of it
again. `packages/keel/src/demo-static/` owns the hash router, the in-memory world and the panel
composition; an app's twin is a composition root that adds its own rows and cards through
`DemoWorldOptions` plus a dashboard render prop, so the framework needs no app vocabulary.

Two findings there are not obvious and cost real time:

- **Importing a seam REGISTRY into the demo bundle is a trap.** Deriving the notified job kinds by
  importing the app's job registry pulled that module's handler graph — db, email, next-intl-server —
  into a bundle that has no server, and Rollup could not shake it out: the single-file demo grew 37% in
  one commit. The world derives the same gate structurally instead. **When the static demo grows
  unexpectedly, suspect a seam import before suspecting the feature.**
- **The split costs about 1.3% of bundle size, inherently.** Property names on an exported world object
  cross a module boundary, so esbuild can no longer mangle them the way it did when they were
  function-local bindings. The per-app byte budget (`pnpm check:demo-size`) was not raised to absorb it.

### keel's own tests run against keel's own app seam

The framework carries a conforming seam of its own, **`packages/keel/test-fixture`**: all 17
`@app-config/*` modules in the minimal shape, plus its own two-tenant seed world, one tenant table and
migration, one domain module per registered capability, an `en`/`es` catalog, an LLM replay fixture, and a
route tree. Its vocabulary is deliberately **neither app's** — tenants `harbor`/`lakeside`, orgs
`depot`/`annex`/`steward`/`wharf`, people `fixture-*`, table `dockets`, job kind `export-dockets` — so a
framework test that reacquires a dependency on an APP's world fails loudly instead of passing because two
worlds happened to share a slug.

The root `tsconfig.json` resolves `@app-config/*` there, so the root program — tests, scripts, the whole
of `packages/keel` including its stories — compiles against a seam no adoption step can delete.
`vitest.config.ts` runs keel's suite in a `keel` project aliased at the fixture. The seam-conformance
tests (the i18n partition/parity pair, the composed pglite RLS suite) still run under **every** app
project, which is what stops the fixture becoming the only world the seam is ever proved against.
`vitest.contract.config.ts` is untouched: the fixture is a third 1001+ migration set and must not go near
the contract database.

**Living outside `packages/keel/src` buys no exemption, and treating it as one was a defect.** The
fixture is outside `src/` because `src/` is what the `keel/*` alias resolves to, what the `exports` map
publishes from, and what ships — the fixture is none of those. But the ESLint fence was scoped to
`src/**`, which made `test-fixture/` the one directory in the package where importing an app's `@/*` or
`@app/seed` was legal. A type-only import there is erased at runtime and the root `tsc` resolves `@/*`
program-wide, so it would have passed lint, typecheck AND the test suite, and broken only at
`pnpm init-app --eject-showcase` — precisely the failure the fixture exists to remove. `.jscpd.json` had
the same hole.

Both are closed by **naming** the fixture in every gate, not by moving it: the fence, the duplication
scan, knip's `project`, and the root `tsconfig.json` all list `test-fixture/**` explicitly.
Deliberately NOT applied are `react/jsx-no-literals` and the a11y-attribute literal ban — those govern
user-visible copy, and the fixture has no components tree and its routes are scanned, never served.
**The general lesson: a directory's location enforces nothing. Every gate that is supposed to cover it
has to be seen matching it.**

### The authorization choke point, and what its exemptions promise

Every mutating API route must call `authorize(...)`, and a build-time scan
(`packages/keel/src/authz/authorized-mutations.test.ts`) fails any route that neither does nor has a
justified exemption. The scan walks every app's `apps/*/src/app/api` **and** the framework's own reference
tree, `packages/keel/test-fixture/api`, resolved package-relative so it exists in every checkout
regardless of which apps do. Exemption staleness is measured against the **fixture** tree, which is the
only honest reading once apps are pluggable: an adopter who ships no assistant route has not made the
"stateless model call" exemption a lie.

Because exemptions are matched **by relative path in every root**, a bare exemption would exempt an
adopter's same-named route from authorization entirely. So **every exemption carries a `mustMatch`** — a
pattern naming the gate its reason rests on, required by the interface and re-checked at run time by a
meta-case, because a type is not present when the suite runs. `profile/route.ts` must contain
`auth.updateProfile(`, a port call that takes no user id and therefore cannot express "update someone
else". An org-switch route must contain `auth.setActiveOrg(`, the call that enforces membership at the
port. A simulator or upload route must contain its `if (!isSimulated)` 404. A service or webhook route
must contain its signature wrapper.

The promise is therefore precise, and stops where it stops: **an exempted route must demonstrate the
mechanism its exemption claims, not merely sit at the exempted path** — and a gate proves the route is
the KIND the reason describes, never the reason's whole claim. `llm.complete(` shows a file is the
model-calling route, not that it persists nothing. The gates are strongest where the reason is mechanical
(a mode 404, a signature wrapper, a self-only port call) and weakest where it is about intent. **If you
are adding a route under an exempted path, the exemption is not permission** — read its reason and decide
whether your route is really the thing it describes.

The walk guard is per-root, so a mis-resolved root cannot hide behind another's results. It demands a
route file per root, not a _mutating_ one: requiring a mutation from every app root would fail this
framework test for an app that is legitimately read-only, which is a false accusation rather than a gate.
Non-vacuity of the exemption machinery is the fixture root's job.

### Naming: one proper noun per half

The package is **keel** — the structural member laid down first, that the whole hull is built onto and
nobody sees again. The fake world and the panel that surfaces it are both the **Simulator**, deliberately
sharing a name because the panel is the world's only surface, and the name is precisely true: the panel is
mounted if and only if `isSimulated`, and that flag swaps all seven ports at once, so whenever it is on
screen nothing outside it is real. The line between the two halves is `APP_MODE`, which is why the run
mode takes the Simulator's word: `AppMode = 'simulated' | 'real'`.

Two naming rules fell out, and they are the transferable part:

- **Name a package for its structural role, not for its most vivid surface.** The framework's working
  name was taken from its dev panel; that made one word mean three things in one repo, and picking a
  synonym for the same surface would have repeated the mistake, because the package is far broader than
  the world it simulates.
- **One proper noun per half; everything inside is named literally.** The Simulator's own tabs are
  People, Mail, Messages, Events, Jobs, Hooks, Errors, Snapshots and Tours, with app-registered tabs
  (Actors, in the showcase) slotting in between Hooks and Errors so the panel knows nothing of app
  content. The test that produced those names: **a name that gets glossed in the next line of copy is
  not earning its keep.**

Two words that look like exceptions and are not. **`Actors`** is the actor model, not the theatre —
autonomous entities that run on their own, hold private state and process one message at a time, which is
exactly what the tab offers — and it is already the authorization word (`AbilityActor`, the
`actor_user_id` audit column); those are not two meanings, because when an actor claims a job over the
service API it IS the authorization actor on the resulting audit row. **`fake`** stays the adapter kind:
in the test-double sense a fake is a working implementation with a shortcut, which is exactly what pglite
is for Postgres, so `if (isSimulated) → fakeDb` is two correctly-named concepts composing.

## Consequences

- The app registers through exactly the APIs a future real app would use. The acceptance criterion is
  checkable by grep: no app vocabulary inside framework directories.
- **New framework capabilities must ship their seam registration point, with an empty default, in the
  same slice** — the "fake in the same PR" invariant, extended to the extension surface.
- **`@app-config/*` is a bare specifier, so every tool that resolves it inherits a single choice of
  app.** That is the root cause behind two mechanical facts: `vitest.config.ts` needs one project per app
  plus one for the framework, and the contract runner stays single-app (two apps share migrations
  0001–0999 but diverge from 1001, so running one app's `migrateToLatest` over the other's database makes
  Kysely report corrupted migrations — a second contract run needs a second database, not just a second
  alias set).
- Ejecting the demo app leaves a green gate: `pnpm init-app <slug> --eject-showcase && pnpm install &&
pnpm verify` exits 0 end to end.
- The framework's own tests are proved against the fixture, and the seam is proved against real apps.
  Neither alone would be enough: the fixture cannot tell you a contract is awkward to satisfy, and an app
  cannot tell you the framework still works without it.
- Deferred deliberately: self-fetching tab components promoted into the framework (they would force the
  static twin to fake `fetch`), and per-capability package splits (a publish-time question, ADR-0013).

## Addendum — 2026-10-03: the fixture gets its own contract database

The Decision says `vitest.contract.config.ts` is untouched and the fixture "must not go near the contract
database". The first half no longer holds; the reasoning behind the second half still does. The fixture
now has a contract run of its own: a `keel` project in that config, aliased at the fixture seam, whose
harness creates a separate `keel_contract` database on the same server. It never touches the contract
app's database, so the "two 1001+ sets over one database" failure the Decision guarded against cannot
occur. The trigger was an engine-parity proof (a `date` column, `docs/decision-log.md` 2026-10-03) that is
only worth anything on real Postgres. The Consequences' "contract runner stays single-app" is now "one app
plus the framework's own seam". A second APP still needs its own project and database, and
`.claude/future-tasks/contract-suite-single-app.md` stays open for that.
