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

## Addendum (2026-10-03): demo presets on the `simulator` seam

`@app-config/simulator` now also exports **`presets`** (`DemoPreset[]`, contract in `keel/core/presets.ts`),
read as a value by the static world, the Snapshots tab, `saveSnapshot`'s reserved-name check and the server
replay (`keel/server-lib/demo-presets.ts`). That is no new entry on the enumerated value-import list: it is
the same module, and the same kind of registration as its flags. The empty form is `presets = []`, which
renders no presets section. The fixture registers one preset in its own vocabulary, so keel's replay test
never borrows an app's world. A registered preset is seam-conformance-tested under every app
(`server-lib/demo-presets-seam.test.ts`) against the seed and registries it will replay into.

The public surface grows by three subpaths, `core/presets`, `server-lib/demo-presets` and `server-lib/invite`,
to **129**. The internal count is unchanged at 34.

## Addendum (2026-10-03, later): presets get their own seam module

`presets` moves out of `@app-config/simulator` into **`@app-config/presets`**, a new seam module and a new
entry on the enumerated value-import list above: the static world, the Snapshots tab, `saveSnapshot`'s
reserved-name check and the server replay all read it as a value. This supersedes the same-day addendum
above, which kept presets on `simulator` because that module was already on the list. `simulator` goes back
to the panel's extra tabs and feature flags (`flags`, `tabs`, `actorsHeldFlag`).

The reason is that a preset registry is its own subject. It is expected to grow to dozens of entries, one
file per preset, and it now carries composition: `DemoPreset.extends` names one other preset (single
inheritance) that is replayed first, and `expandPreset` in `keel/core/presets.ts` flattens the chain for
both hosts. Sharing a file with the panel's tabs and flags no longer described either. The empty form is
unchanged in meaning (`presets = []`, no presets section), and `presetProblems` validates the expanded
script, so an unknown base, a cycle, or a duplicate invite split across a chain fails the seam-conformance
test under every app.

The fixture's seam is now **18** modules (`presets.ts` added). It registers `busy-harbor` and a child,
`busy-harbor-lead`, which extends it, so keel's replay test proves inheritance in keel's own vocabulary.
The public surface and internal counts are unchanged.

## Addendum (2026-10-03, later still): preset operation kinds and `@app-config/preset-operations`

Demo-preset operation kinds become a registry the framework and the app both extend. Two seam changes:

- **`@app-config/presets` exports two more things.** `appPresetOperations` (`PresetOperationDefinition[]`,
  contract in `keel/core/presets.ts`) is the app's operation DEFINITIONS — argument schema, product
  rules, consumed names — read as a value by keel's seam-conformance suite. `AppPresetOperation` is a TYPE,
  composed into `PresetOperation = FrameworkPresetOperation | AppPresetOperation` exactly as job kinds
  compose; the empty form is `never` and `[]`. Definitions are pure, so the static demo may bundle the
  module as before. Nothing new on the enumerated value-import list: `presets` is already on it.
- **`@app-config/preset-operations` is a new seam module, SERVER-ONLY, and a new entry on the enumerated
  value-import list.** It exports `appPresetOperationHandlers`, the app's server halves keyed by kind,
  which `keel/server-lib/demo-presets.ts` composes over keel's (`{ ...framework, ...app }`, so an app
  entry with a framework kind's name replaces it). It is a separate module from `presets` because the
  static demo bundles `presets`, and a server half reaches modules (`server-only`, pglite) that stop that
  bundle loading. The static halves do not go on the seam at all: like the inbound-email twins, the
  static composition root supplies them through `DemoWorldOptions.presetOperations`, because they act on
  that root's own in-memory rows. The empty form is `{}`.

The contract is typed against the Standard Schema v1 interface (vendored as types in
`keel/core/standard-schema.ts`), not against a validation library, so the seam does not choose one for the
app; keel's own kinds happen to use Valibot.

The fixture's seam is now **19** modules (`preset-operations.ts` added). It registers one app kind,
`docket.flag`, which consumes a named result an `inbound` step produced, and a `flag` server half that
replaces keel's by name, so keel's replay test proves both in keel's own vocabulary.

The public surface grows by one subpath, `server-lib/preset-operations` (the server-half types, keel's
own halves to wrap, and `resolvePresetOrg`), to **130**. The internal count is **37**: `core/standard-schema` is new, and re-deriving it (non-test modules
under `src/` that the map does not publish) found two more that earlier figures missed —
`components/simulator/tab-mount` and `components/simulator/people-dimensions`, added on `main` while the
count stayed at 34. That number is now gated too: `public-surface.test.ts` holds the sentence in
`docs/adopting.md` to the walked count, as it already held CLAUDE.md's published count.

## Addendum (2026-10-03, later still: per-actor holds): `@app-config/actors` gains a value

`@app-config/actors` was type-only (`ActorId`); it now also exports **`actors`**, the registered actors as a
`readonly { id: string }[]` (the showcase's carries each actor's copy keys as well). keel's `actor.hold`
demo-preset kind must reject an actor id the app did not register, and its definition is pure, so
`PresetWorld` gains `actors` and the seam-conformance suite derives it from this list, the way it derives
people, teams, handlers and flags. The empty form is `actors = []` alongside `type ActorId = never`.

This is **not a new entry on the enumerated value-import list**: only a test reads the value. Framework
runtime code still takes `ActorId` as a type, and neither host's `actor.hold` half validates its argument
(the gate already has). The cost is that every registration must now provide the list, which is why the
starter gained `actors = []` and the fixture, whose registration was empty, now registers one actor
(`fixture-tug`): keel's replay test cannot prove that a hold is written, nor the gate that a known id passes
and an unknown one is named, against an empty list. The fixture hosts no panel, so the actor is only an id.

The fixture's seam is still **19** modules, and the public and internal counts are unchanged.

## Addendum (2026-10-03, last): the fixture's seam is no longer counted

The addenda above give the fixture's seam as 18 modules, then 19. Neither number came with a counting
rule, and different rules give different answers:

- top-level `app-config/` files alone;
- those plus the `db/` registrations;
- those plus the files under `presets/operations/`.

The body's "17" was already one off by the rule it seemed to use. So the count is dropped rather than
corrected. CLAUDE.md now says what the fixture registers ("every `@app-config/*` module the framework
reads"), and the seam-conformance suites, not a number, are what hold the fixture to it. The published
and internal counts above keep their numbers, because each has a stated rule and a test.

## Addendum — 2026-11-16: the scan walks each app's whole `src/app`

The section on the authorization choke point says the scan walks every app's `apps/*/src/app/api`. It
walks every `route.{ts,tsx,js,jsx,mjs}` under each app's whole `src/app`, because Next serves a `route.ts`
from anywhere there and not only under `api/`. Exemption keys are still paths relative to `src/app/api`, so
a mutating route outside `api/` can match no exemption and must call `authorize(...)` itself. The fixture
root, `packages/keel/test-fixture/api`, is unchanged, and so is the rest of the decision.

## Addendum (2026-11-16): an app may own ports and adapters

The Decision puts ports and adapters on the framework side of the line, and the fence allowed a vendor SDK
in one directory of product code, `packages/keel/src/adapters/` (plus two carve-outs outside the request
path, each app's `next.config.ts` and its contract tests). Meanwhile `docs/development-approach.md` sends
vendor code that fails the universality and new-class tests to the app, as a recipe. Together they left an
adopter's app nowhere legal to put the adapter. The case that surfaced it was a CDN key-value store signed
with SigV4A, needed by one adopter's app and by no other instance. Putting it in `packages/keel` instead
would contradict ADR-0013, because a port keel would never accept upstream would stay in the fork as a
merge conflict.

**An app may now own a port, its fake and its real adapter**, under `apps/<app>/src/`. This does not move
the line, because they are app code: keel still cannot import them (`@/*` is banned inside the package),
and an app's port is invisible to keel's registry. What changed is the fence, which is drawn once more
around the new directory with the same invariants:

- **Vendor SDKs** may be imported in `apps/<app>/src/adapters/real/` and nowhere else in the app. The
  app's registry (`adapters/index.ts`) and fakes are banned like the rest of the app. keel's fixture gets
  no such zone: `packages/keel/test-fixture/adapters/real/` is banned like the rest of the fixture.
- **`process.env`** may be read in that same `real/` directory, for the adapter's own configuration, but
  never `APP_MODE`, `DEMO_MODE` or `E2E_BUILD`. The registry cannot read `process.env` at all, and neither
  can the app's `config/`, so the registry takes the run mode from keel's `isSimulated`. Importing that also
  runs keel's fail-closed production guard and makes the registry server-only. That last step is
  convention: lint cannot follow an imported value to its source.
- **A real adapter is reached through the registry.** Inside the app's adapters directory, only the
  registry reaches `real/`, and only by `import()`: a static import from the registry, or any import from
  a fake, would load the vendor in simulated mode. The registry and fakes also may not import keel's own
  published real adapters statically. Outside the directory, a static import of `adapters/real` fails lint and a dynamic `import()` does not. That is the
  sanctioned way to load a real-mode-only component inside an `!isSimulated` branch, as the sign-in page
  already loads keel's. Such a component renders copy, so `react/jsx-no-literals` and the a11y-attribute
  literal ban now cover both adapter trees' `.tsx` files; keel's already complied.

**The vendor fence had a hole, now closed.** `no-restricted-imports` sees import and export declarations
and never `import()`. Before this change, `await import('@aws-sdk/client-s3')` passed lint in an app's
domain module, in a route, and in keel's own `server-lib`. The new rule `keel/no-dynamic-vendor-import`
reads the same `vendorSdkPattern` list and covers the same files minus the same two zones and the same two
carve-outs, the fixture included. It also sees vitest/jest's `importActual`-style loaders. Nothing in the tree used the hole, but app-owned registries make `await import('./real/…')` the
idiom one directory away.

**The static demo is not linted for this, and it is guarded.** If a screen the demo bundles imports an app
registry, `build:demo-static` succeeds. Measured with a scratch registry wired into the starter's twin: the
bundle contained keel's registry and its production guard, pglite, the scratch real adapter (dynamic imports
are inlined) and `server-only`'s throw, and came to 54 MB against an 880,000-byte budget. `check:demo-size`
failed it, and the static e2e failed after it. A lint ban would see only direct imports, and in practice the import arrives
through a domain module. keel's own screens have the same rule and the same backstop.

Rejected alternatives:

- **A key-value port in keel.** It fails universality, since few instances keep state at a CDN edge, and
  it fails new-class, since an authenticated outbound SDK call is what the storage, LLM and email adapters
  already teach. It would be the "one adapter per vendor an instance might someday want" drift that
  `docs/development-approach.md` warns against.
- **The whole of `apps/<app>/src/adapters/` as the vendor zone**, as requested. The registry and the fakes
  are what keep `pnpm dev` hermetic, and allowing them a vendor SDK or `process.env` would let an adopter
  write a fake that reaches the network, or a registry that picks its own mode.
- **App configuration through `config/params.ts` imports instead of `process.env`.** Secret values cannot
  live in the repo, and keel's own real adapters already read the environment. `params.ts` stays the record
  of non-secret values and secret names, with their cutover rows.
- **A worked example in the starter.** The starter is the minimum an adopter keeps, and a port nobody calls
  is dead code they would have to delete. A real adapter would also need a vendor dependency added purely
  for demonstration. keel's seven ports already demonstrate the shape, and the new directory is proved by
  `tests/lint/app-owned-adapters.test.ts`, which lints virtual files against the repo's real config.
  At the PR's final head, 28 single-fence mutations of `eslint.config.mjs` were run against it: 26 turned it
  red, and the other two removed carve-outs that only make the outcome independent of block order, as
  `eslint.config.mjs` says beside them.

`docs/recipes/app-owned-adapter.md` is the how-to, and `/new-port` now asks whose port it is first.

## Addendum (2026-11-16, later): the fences cover every extension, and selectors travel as sets

The trap named under "The fence" bit again, on `no-restricted-syntax` rather than
`no-restricted-imports`: the last block for routes, pages and components re-listed two of the three
`getDb` selectors, so `db['getDb']()` passed lint in a route handler. Selectors that implement one rule now
travel as one array (`getDbSelectors`, `runModeEnvSelectors`), so a block can drop a whole rule but not one
form of it. Re-listing shared PATTERNS on `no-restricted-imports` is unchanged.

Every fence in `eslint.config.mjs` also named `*.{ts,tsx}`, which left `.js`, `.jsx`, `.mjs`, `.cjs`,
`.mts` and `.cts` files on both sides of the line unfenced. The fences now take their extensions from one
constant, `SRC_EXT`, and hold for all eight. The carve-outs do not: each names what its runner loads (vitest's
`*.test.{ts,tsx}`, Ladle's stories, Next's four `next.config` names, Next's instrumentation hooks), so a
file nothing loads under that name keeps every ban. `tests/lint/extensions.test.ts` and
`tests/lint/tenancy.test.ts` pin both.

## Addendum (2026-11-16): `authorize()` judges actors that are not sessions

**Why.** `authorize()` took only a session's `AuthUser`, so a caller that was not a browser session
could not reach the choke point. An adopter (the sharing site's console) hit this with two callers. A
CLI holds a **personal API token**: it acts as the person who approved it, with that person's current
role, and removing the person stops their tokens at once. That is the console's design of record as its
token-branch worker reported it through the keel manager; its `main` has the token verifier only as a
seam. CI will hold a GitHub OIDC token: it is a
principal of its own, not a person. The console worked around this by building a stand-in `AuthUser`
for the token's owner, with placeholder role and locale. keel had one non-person path of its own,
the per-org service keys. They sat under a `service/` prefix exemption whose reason was "org-scoped by
construction", which gave a service route no per-action check and no rule anyone could read.

**Actors carry a credential.** An actor now records HOW it proved who it is, not only who it is. A
`Credential` is `{ kind, id }`. `id` names WHICH credential (a token's row id, a service key's id, the
inbound email's id), so an audit row can say which one acted. It is never a secret, and it is `null`
for a session. The kinds are composed unions, like every other framework vocabulary:

- `PersonCredentialKind = 'session' | 'inbound-email' | AppPersonCredentialKind`
- `MachineCredentialKind = 'service-key' | AppMachineCredentialKind`

The two `App…CredentialKind` types are new type-only exports of the abilities seam (`never` when
unused), so the console's `api-token` and `cli-login`, and later `github-oidc`, need no framework edit.
The two unions must not overlap: a type-level check in `keel/core/abilities` fails the build if an app
registers the same kind on both sides.

**Two kinds of actor.** `keel/core/abilities` exports `Actor = AbilityActor | MachineActor`.

- **A person.** `AbilityActor` gains an optional `kind: 'person'` and an optional `credential`, so every
  existing literal that states a session, or sets `manageAll: false`, still compiles and is still judged by
  the person rules. (A literal that could set `manageAll` without stating a session no longer compiles;
  see the review below.) A missing credential means
  "not stated", never "a session": such an actor doesn't wield `manageAll`, and the audit trail records
  no credential for it. The three literals in this repo that stand for a session (the two static shells
  and a preset check) now say so.
- **A machine.** `MachineActor` is `{ kind: 'machine', credential, principalId, activeOrgId }`, where
  `principalId` is `<credential kind>:<id>`. It has no `role`, no `restricted` flag and no `manageAll`.

**A person who reached the app without a session.** `abilityActorFromCredential(auth, { userId, org,
credential })` builds the person behind an inbound email or a personal token, and it owns the property
the adopter asked for: role and `restricted` are read from the auth port on every call, through a new
port method, `getMember(orgSlug, userId)` (see ADR-0003's addendum of this date).

- It takes no role, so a role can be neither cached in the credential nor derived from it.
- It returns `null` when the person is no longer an active member, so a removed person's credential
  fails on the next call. Tests prove both by changing the world between two calls.
- Such a person never wields `manageAll`. `defineAbilitiesFor` honours `manageAll` only for an actor
  that states a `session` credential, whatever else the actor says, and hands the app's rules the same
  effective value. The rule holds without trusting whoever built the actor.
- It refuses, at run time, to build from a `session` credential, which the type alone cannot stop if an
  app registers that name.

keel exercises this kind itself through inbound email. The sender is matched by address, as before,
and then becomes a person actor whose credential is the email. Their standing now comes from the same
place their session's does. Before, inbound email derived `restricted` from the role alone, while a
real-mode session read only the flag; both now use `isRestricted(flag, role)` (ADR-0003 addendum).

**Narrowing is by credential kind, in the app's rules.** The console needs "publisher administration
takes a browser session". The app's rules see `actor.credential.kind`, so that is one line in
`appAbilityRules`; the fixture's Docket rule does exactly this for `delete`. A per-CREDENTIAL ceiling
(one token allowed less than its owner) is not built, because nothing needs it yet. Its place is marked
in `defineAbilitiesFor`, where it would intersect `can()` for every caller.

**One choke point, two forms.** `authorize(actor, action, subject)` sits beside
`authorize(user, activeOrgId, action, subject)`. The second form is shorthand for the first with
`abilityActorFromUser` (which now records a `session` credential), so every existing call is unchanged.
The scan's `authorize(` pattern matches both forms, and its failure message now names the three
non-session constructors.

**Machines are judged by a separate table, and it denies by default.**

- **Base subjects** go to `frameworkMachineRules`, a record keyed by `BaseSubjectType`, so a new base
  subject fails the typecheck until someone decides what machines may do with it. Its one grant: Job
  `read`/`update` in the machine's own org, for keel's `service-key` credential only. That is what the
  job service API exists for.
- **App subjects** go to a new seam export, `appMachineAbilityRules`, which conforms to
  `MachineAbilityRules`. The empty registration returns `false`. The export joins the enumerated
  `abilities` value imports, since it is an ability rule.

Machines were not passed to `appAbilityRules`. Both apps' person rules let any member who is not
`restricted` author the app's own subjects (the showcase's tickets and attachments, the starter's items), so any role given
to a machine would hand it that authoring by default.

**Building a machine.**

- `abilityActorFromService(identity)` builds `service-key:<org slug>`, acting in its key's org. Its
  credential id is the `service_keys` row that verified the call (`ServiceIdentity` gains `keyId`).
- `machineActor({ kind, id, credentialId?, activeOrgId })` is for the app's own verifier. `kind` is typed
  to the app's machine kinds. At run time it also refuses keel's own kinds and `system` (which keel's
  background writers record as), a kind that is not a lowercase slug, and an empty id or org.

**Tenant.** The tenant binding is unchanged. An actor carries its org; the tenant comes from the
verified credential and still scopes every query through `withTenant`, and `authorize()` stays pure. A
credential that names its tenant, such as the console's `pages_<tenant slug>_…` tokens, already
resolves through `tenantIdForSlug`. A credential that does not is
`.claude/future-tasks/service-auth-flexibility.md`'s third item.

**Audit.** Framework migration `0014_audit_credential` adds two nullable columns to `audit_events`:
`credential_kind` and `credential_id`. NULL means "not recorded", which is true of every older row and
of writers that don't pass a credential. A NOT NULL default would have claimed a kind nobody can vouch
for. `app_user` keeps SELECT and INSERT only, because table-level grants cover added columns, and the
RLS proofs insert and read the new columns as `app_user` on both engines.
`auditActorOf(actor)` gives `{ actorUserId, credential }`. A person is recorded by user id, with
their credential. A machine is recorded by its principal id. Keel's inbound intake, the showcase's email handlers and the fixture's handler write it. The session routes still write `actorUserId` alone, so their rows record NULL.

**The migrator now runs unordered.** 0014 is the first framework migration added after both apps had
run their own (≥1001). It surfaced a defect in how the two numbered sequences compose: Kysely's default
strict ordering refused it on any database that had run an app migration ("corrupted migrations:
expected … 1001_items … but 0014_audit_credential was found"). So no framework migration could reach an
existing database, an adopter's deployed one included. CI never saw this, because every CI database
starts empty. A reused local world did. `migrateToLatest` now sets `allowUnorderedMigrations`: pending
migrations still run in name order, and a migration the database ran that has since disappeared still
fails.

The cost is a rule. A new framework migration runs after the app's migrations on an upgraded database
and before them on a fresh one, so it must have the same effect in either position. It names the
objects it touches, and never sweeps the catalog with `GRANT … ON ALL TABLES` or
`ALTER DEFAULT PRIVILEGES`. Strict ordering was also the only thing that refused an app migration
numbered into the framework range. Both are now a seam-conformance test,
`packages/keel/src/db/migrate.test.ts`, run against the fixture and every app:

- it holds every app migration to ≥1001, with no name shared with a framework one;
- it migrates an "old" database forward and compares it with a fresh one: RLS enabled and forced per
  table, policies (with roles), `app_user`'s table and column grants, columns, constraints, indexes,
  triggers and functions.

Under strict ordering the upgrade fails with the production error. A catalog-sweeping `GRANT` fails the
comparison, and so does a sweep that un-forces RLS on whatever tables exist. A migration that un-forces RLS
on a NAMED table is the same in either position, so the comparison passes it. `rls-pglite.test.ts` catches
that one instead ("has RLS but not FORCE ROW LEVEL SECURITY", via the RLS coverage proof).

The comparison's "old" database is built the way it really stood before the update. The registry, minus
the newest framework migration, is applied one migration at a time, and the build stops at the first app
migration that cannot run without it. An app migration that builds on a new framework migration arrives
with it, and the two apply together. A synthetic registry in the same file pins that case: an app index
on a column only the newest framework migration adds.

Unordered mode had also stopped Kysely refusing an app migration that runs after a later app migration,
as two branches' 1005 and 1006 can. So `migrateToLatest` runs a preflight first: a pending migration that
sorts before an executed one of its OWN sequence is refused, and only framework-before-app may run out
of order. The preflight leaves one Kysely behaviour alone: a database that ran a migration the registry
no longer has still gets the "is missing" error, not a misleading out-of-order one.

The preflight reads the migration table outside Kysely's lock. Two migrators running the SAME release
are safe. Two different releases migrating one database at the same moment could each pass the check
on a stale read. That is accepted: keel migrates once per deploy.

**The `service/` exemption is retired.** The showcase's one mutating service route,
`service/jobs/[id]/status/route.ts`, calls `authorize(actor, 'update', Job)` with the actor that
`withServiceCaller` now passes. The fixture's `service/jobs/route.ts` is the scan's machine route, named
as an invariant and no longer backed by an exemption. The body's "a service or webhook route must contain its signature wrapper" still holds for both: for
webhooks as the exemption's gate, for service routes as a gate required alongside `authorize(` (below). The cost falls on adopters: a mutating
route under `api/service/` must now call `authorize(...)`, and the scan's message says how.

What the old exemption also guaranteed is kept: under `service/` the scan requires `withServiceCaller`
**in addition to** `authorize(` (`REQUIRED_ALONGSIDE`). Otherwise a route could satisfy the scan by
authorizing a machine literal built from the request. The gate proves the wrapper is present, not that
the actor authorized is the one the wrapper built. That is the kind-not-claim limit stated above.

The broader fix was considered and not built. A lint rule banning `kind: 'machine'` literals outside
`keel/authz` would catch a fabricated actor anywhere. But keel has never guarded against a route
fabricating an `AuthUser` either, and the fixture's own routes build actors by hand to be scanned.

**What stays in the app.** keel owns the vocabulary, the constructors, the fresh standing, the
`manageAll` rule and the audit columns. A personal token's storage, hashing, issuance and revocation
stay in the app for now. They plausibly pass the universality test
(`.claude/future-tasks/personal-api-tokens.md`).

**Not done:**

- The session routes don't record their `session` credential yet.
- The naming section says a service caller claiming a job "IS the authorization actor on the resulting
  audit row". The first half is now true. The second is not, and was not before: a status report writes
  the job timeline, not `audit_events` (`.claude/future-tasks/machine-status-reports-unaudited.md`).

**JP's decision (2026-11-16).** The fork this work raised was put to JP: should a machine's powers come
from the app's abilities seam, or from per-credential grants stored with each key or token? He chose the
abilities seam: a deny-by-default `appMachineAbilityRules`, with no per-token scopes built and the place
for a later cap left marked. Retiring the `service/` exemption stands.

**An independent review, and what it changed (2026-11-16).** A cold review by a different model, with the
keel manager deciding each finding:

- **A possibly-true `manageAll` must state a session, in the type.** `AbilityActor` is now two shapes: one
  with `manageAll: false` and any credential (or none), and one with a session credential and any
  `manageAll`. A literal that could set `manageAll` without stating a session is a compile error. The run
  time keeps refusing it. It was already failing closed, but silently.
- **Session-only framework subjects.** Inviting or managing members (Membership), changing the org (Org),
  managing webhook endpoints (WebhookEndpoint) and accepting terms (AgreementAcceptance, a legal act) are
  refused to any person whose credential is not a stated session. An app widens one subject at a time on
  the seam, `nonSessionAdministration` (default `{}`); the export joins the enumerated `abilities` value
  imports. It can never widen to `inbound-email`, by type (`WidenableCredentialKind`) and at run time.
  Reads are not gated. Not listed: service keys (no route mints one, and they are no ability subject), the
  other self-only subjects, the system-managed ones, and Job (a product action).
- **A malformed actor is denied, not judged as a person.** Anything not a machine must be a well-formed
  person (`kind` 'person' or absent, a real role, boolean `restricted` and `manageAll`, a credential with a
  string kind), or it gets nothing. A machine that lost its `kind` had been judged as a person with no
  role. The person is judged as a copy made by NAMING each field, so an actor whose fields are getters or
  live on a prototype is judged by them, not by the empty result of `{ ...actor }`.
- **One row gives an org's id and slug.** `abilityActorFromCredential` takes an `OrgIdentity`, which is
  BRANDED: `orgIdentityForSlug` (`keel/db/org-lookup`) is its only producer, and the inbound intake gets
  `ctx.org` through it as well. A hand-paired `{ id, slug }` does not compile.
- **The handler reports the credential.** `InboundHandlerResult` carries `credential`, and the intake
  records exactly that, or NULL. A synthetic actor a handler names is no longer recorded as an email
  credential.
- **A banned person has no standing** (ADR-0003's addendum).

## Addendum (2026-11-16, last): the fence holds outside declarations

The framework/app fence and keel/core's framework ban were `no-restricted-imports` groups and nothing
else, so they never saw `import()`, `require()` or a type-position `import('…')`. In keel's fixture,
`export type T = import('@/domain/tickets').Ticket` linted clean: the type-only escape the fixture's fence
exists to stop. `keel/no-dynamic-app-import` and `keel/no-dynamic-framework-import-in-core` now hold both
fences there. They match each group through the same `ignore` matcher `no-restricted-imports` uses, so
the two halves of a fence read a specifier the same way, and `tests/lint/framework-fence.test.ts` checks
that specifier by specifier.

## Addendum (2026-11-17): an audit row can say why

The trail said who acted, what they did, to which subject, when, and (since 0014) with which credential.
It could not say why: a refused credential's reason (unknown, revoked, expired), or how many rows a purge
removed. The first adopter, the pages console, asked for both.

**The column.** Framework migration `0016_audit_detail` adds a nullable `detail jsonb` to `audit_events`.
NULL means "none recorded": every older row, and every writer that passes none. The grant is unchanged.
`app_user` keeps SELECT and INSERT only, and table-level grants cover the new column. The RLS proofs write
and read a nested detail as `app_user` on both engines, and prove that an UPDATE of it is refused.

**Never a secret, a token, a password or free-form personal data.** `app_user` holds no UPDATE or DELETE
on the table, so the app can never correct or redact a detail once written. Record a code or a count.

**The writer is the gate.** `recordAuditEvent` takes an optional `detail` (`AuditDetail`, `keel/db/audit`)
and checks it before it opens a transaction. The type admits only JSON (strings, numbers, booleans, null,
arrays and plain objects), so a Date, a function or an explicit `undefined` does not compile. At run time
the check goes in three steps:

1. What the caller passed must be JSON: no non-finite number, no class instance, nothing nested deeper
   than four levels, no `undefined` in an array. An object property left undefined is skipped, as JSON
   writes it.
2. It is serialized once, and that text must be at most 1024 bytes. The bound comes before any pattern
   reads a string: scanning a 60 KB string with the email pattern first took seconds.
3. The parsed text is checked again, and it is what gets written. A `toJSON`, a getter or a Proxy can make
   what is serialized differ from what was passed, so the rules below read the serialized form:
    - no NUL or unpaired surrogate in a string (Postgres's jsonb refuses both, and would fail the insert);
    - no key whose last word, or last two words joined, names a secret (`token`, `password`, `secret`,
      `cookie`, `pin`, `apiKey`, `accessKey`, `cardNumber`, `ssn` and the like; a trailing number or `v2`
      is ignored). A boolean or null under such a key passes (`missingToken: true`). A plural passes only as
      a number under a qualifying word (`revokedTokens: 3`), since a bare `otps: 482913` may be the code
      itself;
    - no key or string value shaped like an email address (in any script), a JWT or a `Bearer` credential.

The error names the rule and the path, never the value, which may be the secret it refused. A key in the
path that is long or fails a shape check is withheld too.

These checks catch the likely accident, which is spreading a request, a member or an error into the detail.
They are not a scrubber: a secret under an innocent key, in an innocent shape, passes. The rule above is the
contract.

**A run-time denylist, not a lint rule.** A lint rule sees the literal keys at a call site. The accident it
would have to catch is a spread or a variable (`detail: { ...body }`, `detail: { error: err.message }`),
which only a run-time check sees. The denylist names secrets by their key, which is reliable. It does not
try to name personal data by key, which is not (a name, a note or an address can sit under any key). The
one personal-data shape keel itself handles, an email address, is caught by its value.

**No CHECK constraint.** jsonb rewrites numbers and whitespace (`1e2` reads back as `100`), so a byte bound
in SQL would measure a different text from the writer's, and the two could disagree about the same detail.

**Keel's own use: inbound intake.** The `inbound-email.received` row now records why the email was filed as
it was, in a closed vocabulary (`InboundReceivedDetail`, `keel/core/inbound-email`):

- `{ outcome: 'handled' }`;
- `{ outcome: 'unmatched', cause: 'no-handler' }` or `{ outcome: 'unmatched', cause: 'declined' }`;
- `{ outcome: 'failed', cause: 'handler-threw' }`.

The static twin records the same. A fourth cause, `{ outcome: 'failed', cause: 'intake-threw' }`, is the
server's alone: the handler returned, and intake's own recording of its result then threw, so the handler's
effect may already have happened. The handler's own reason never goes in: it is free text, and keel's
handlers write the sender's address into it. It stays on the `inbound_emails` row.

Intake now finds a handler only as an own entry of the registry. Before, `<org>+constructor@…` found
`Object.prototype.constructor` and was filed as a message its handler declined.

**Reading it.** The Simulator's Events tab shows `detail` inside the expanded row's JSON, as a React text
child, so it is escaped and never parsed as HTML. An adopter's own audit screen must do the same: render it
as text, never through `dangerouslySetInnerHTML` or a Markdown renderer.

**What an adopter does.** Nothing to copy. 0016 runs on the next migrator run, and existing rows read NULL.
To record a why, pass `detail` to `recordAuditEvent`.
