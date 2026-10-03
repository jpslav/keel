# Development approach

How this scaffold is built and extended — the operating philosophy behind the architecture. The
[ADRs](adr/) record the specific one-way-door _decisions_; this document explains the _why_ they serve,
so new contributors and AI agents extend the codebase in the same grain.

It is deliberately generic. Product features live on top of the scaffold and are out of scope here; this
is the reusable foundation, described in reusable terms.

**Status legend** — the doctrine is the north star; not all of it is built yet.

- **✅ Implemented** — the scaffold does this today; look at the code.
- **🧭 Intended** — the pattern we're aiming for; not built in this scaffold yet, documented so later work
  lands in the right grain.

## The two invariants everything protects

Two rules thread through every section below. Most of the doctrine exists to keep them true, and any new
work is measured against them:

1. **Hermetic local run.** Every feature boots and is testable on a laptop with no docker, no network, no
   credentials — in seconds. This matters most for AI agents: Claude Code is dramatically more productive
   when it can boot the app, run the tests, and see results hermetically rather than waiting on containers
   and cloud round-trips.
2. **A fake in the same PR.** No external dependency — vendor, service, or worker — lands without its fake
   implementation in the same change, so the two points above never regress.

If a proposed change breaks either invariant, that is the thing to fix first.

## Deploy-first — start from a walking skeleton ✅

**Principle.** Stand up an end-to-end sliver of the system — deployed, on a CI pipeline — before any
product logic exists, and buy everything non-differentiating (framework, managed data layer, managed
auth, object storage, the model API). This repo _is_ that walking skeleton: a running, seeded,
multi-tenant-shaped app with the quality rail already wired.

**Why.** Treating infrastructure as a prerequisite turns a week into a quarter. A live skeleton means
every slice thereafter lands on a working pipeline, and the riskiest elements get exercised early instead
of integrated late.

**Tradeoff.** You commit to a few expensive-to-reverse choices up front (framework, data layer, the ports
boundary). That is acceptable precisely because those are the choices worth deciding early — and each is
recorded as an ADR (see _one-way vs two-way doors_ below).

## Thin vertical slices, not horizontal layers 🧭

**Principle.** A unit of work is the smallest increment that delivers observable value end to end — through
UI, API, logic, database, and any external service it touches — and is demoable when done. Slices _cut
through_ subsystems; they are not the subsystems themselves. The first slice to touch a subsystem includes
a crude version of it (a matcher might be "top-5 by embedding similarity," nothing more); later slices
deepen it as real usage demands.

**Why.** Horizontal layers ("build the data model," "build the engine") produce months of work with
nothing to show or test, and half of what an up-front design imagines changes on contact with real use.
Building the crude-everywhere version first puts the whole flow in front of someone quickly.

**Tradeoff.** The constant pressure is to widen a slice because every stakeholder wants their feature
visible early. The slice map (below) is the answer to that pressure, not a bigger slice.

**Spikes are the one exception.** A spike is a timeboxed (2–3 day) throwaway experiment to retire a
_specific_ technical risk ("can embedding similarity on N seeded questions produce usable candidates?").
It produces a one-paragraph written finding, not shipped code. `spikes/` holds these; the pglite dialect
spike is the worked example.

**The slice map** is a thin, ordered backlog — one or two lines per slice. Only the next one or two slices
carry design detail; the rest is re-sequenced freely as evidence arrives. Order by learning and risk:
load-bearing certainties first, genuinely uncertain features after the evidence that can reshape them. The map
is a hypothesis with provenance, and the slices are themselves the validation instrument — it changes when the
evidence says so, not when someone re-raises an argument. (`.claude/commands/new-slice.md` scaffolds a slice
the house way.)

## One-way vs two-way doors — what becomes an ADR ✅

**Principle.** Decide _now_ only the one-way doors — choices that are expensive or impossible to reverse:
the tenancy model, the auth-provider boundary, the data layer, the monorepo/framework, the ports boundary.
Record each as a one-page ADR. Everything else is a two-way door, decided inside a slice and cheaply
reversible. **Design depth follows proximity**: deep design only for what's imminent.

**Why.** This is what keeps "plan the architecture" from becoming big-up-front-design in faster clothing.
Optionality is preserved exactly where it's cheap to keep.

**Tradeoff.** It takes judgment to tell a one-way door from a two-way one; when unsure, prefer fewer ADRs
and a reversible choice. The [ADR index](adr/) holds the accepted set; `docs/decision-log.md` captures the
smaller unplanned decisions a plan didn't anticipate.

## Generate wide, decide narrow — working with AI ✅ (culture)

**Principle.** For any significant choice, have AI produce two or three genuinely different options with
honest tradeoffs; humans select, critique, and constraint-check. When drafting code is cheap, the binding
constraint moves to **review capacity and decision latency** — so remove queues in front of decisions and
keep the team small and senior.

**Why.** AI output is reliably plausible and only _usually_ right; taste, context, and constraint-checking
are the human contribution. And when a design question is genuinely cheaper to answer by building two
versions than by writing about it — now true for most UI and workflow questions — build them.

**Tradeoff.** "Cheaper to build than to argue" is not always true (integration, security correctness, and
data migrations do not compress); apply it where it holds. The hermetic-dev invariant is what makes the
loop fast enough for this to pay off — for agents most of all.

## Ports and adapters — the core structural rule ✅

**Principle.** Every external dependency (auth, database, object storage, LLM, email, analytics) is reached
through a thin interface _the app owns_ — a port — with two implementations, real and fake. **Wrap, don't
stub:** the port is sized to what the app actually needs (a handful of functions), not to the vendor's
hundreds of calls. Exactly one module imports each vendor SDK, and a lint rule (`no-restricted-imports`)
plus a CI check make the boundary permanent.

**Why.** A small owned interface makes the fake trivial to write, keeps dev/demo/test hermetic and
deterministic, and turns a vendor swap into a local change. Stubbing the vendor's surface instead couples
you to it forever.

**Tradeoff.** One thin layer of indirection. On a greenfield app it is near-free; retrofitting onto an app
with vendor calls everywhere is the strangler pattern (introduce the wrapper, forbid new direct imports,
migrate call sites opportunistically). See ADRs [0003](adr/0003-auth-clerk-headless-custom-ui.md),
[0006](adr/0006-isomorphic-core.md), [0009](adr/0009-llm-anthropic.md); `.claude/commands/new-port.md`
scaffolds a port with both adapters.

## What the template ships — three kinds of things ✅

**Principle.** The template ships exactly three kinds of things: (1) universal capabilities, fully
worked — used by essentially every instance, each gets a port, a real adapter for a default vendor, a
fake, and Simulator presence; (2) one worked example per integration class — not the vendor, but the
proven end-to-end shape (async external counterparty with callback, streaming vendor API, presigned
browser upload, verified machine caller, signed webhook egress); (3) recipes for everything else —
written down precisely, in `docs/recipes/` for a vendor-specific plan (e.g. `sms-twilio.md`,
`web-push.md`) or a component-level one (`list-kit.md`), or inline in this doc for a doctrine-level one
(realtime-collab, below) — so known
patterns don't get built early. Instances ship domain features plus
additional members of already-demonstrated classes — more job kinds, more webhook events, more vendor
adapters written by following the worked example.

**The two tests for shipping vendor code.** _Universality_ — will every instance use it? — and
_new-class_ — does it demonstrate integration mechanics the template doesn't already teach? A vendor
adapter must pass at least one; failing both makes it dead code with a maintenance bill, fighting the
project's own dead-code discipline. This is not the same test as whether a _capability_ belongs in the
template — authz, audit, and cross-org requests all shipped port-less because they pass universality
(or new-class) without needing vendor code at all. The port test governs vendor code specifically.

**The third test, for shipping UI: does this component encode a framework invariant, or is it generic
presentation? ✅** The two tests above govern _vendor_ code, and nothing governed components — which
mattered the moment the highest-demand gap on the whole round-2 list turned out to be one
(`docs/app-coverage-gaps.md`: a generic list/table kit, needed as core by 16 of 19 app types). keel ships
a lot of UI, so "the framework doesn't do screens" was never the rule; the rule is what those screens
have in common. Every one of them is **the presentation half of a capability keel owns**: there is no
auth without a sign-in screen, no invitations without an accept flow, no access gates without the
interstitial that resolves them, no simulated world without Simulator. The screen is where the
framework's invariant becomes visible to a person, and it cannot be separated from the capability
without breaking it. A sortable table has no such capability behind it — there is no "table subsystem"
in keel whose rules it enforces — so shipping one would make the framework a second source of generic
components, in direct competition with the one **[ADR-0005](adr/0005-ui-mantine-panda.md) chose as "the
only component library"**. Fails the test → recipe: `docs/recipes/list-kit.md` is the written plan, over
Mantine + TanStack Table, and it is honest that the rest is an instance's choice.

The test is worth trusting because it was derived to decide a NEW case and then found to agree with
every case already decided: applied retroactively, it validates every screen keel already ships and
excludes nothing. A rule invented to justify a decision usually has to make an exception for something;
this one doesn't, which is the difference between a correct rule and a convenient one.

And a test that only ever says "no" is not doing its job. Applied to the list kit it also said what to
KEEP: one part of a list does encode an invariant — **a paginated read of a tenant-scoped table**. The
cursor is client input, so a page-seven read must be scoped exactly like page one; the ordering must be
total or the walk repeats and drops rows; the page size must be capped by the server, not by the query
string. That is a correctness property in the same family as `withTenant`, so it shipped as framework
code (`packages/keel/src/db/keyset.ts` and the pure half `packages/keel/src/core/keyset.ts`), proven in
BOTH halves of the RLS suite on both engines — including against a cursor minted in the other tenant —
and demonstrated on the showcase's ticket queue. Extracting the invariant and leaving the chrome is the
outcome this test is designed to produce.

**Why.** Making the line explicit stops "one worked example per class" from quietly drifting into "one
adapter per vendor an instance might someday want" — the same dead-code-with-a-maintenance-bill failure
mode the ports boundary already guards against for vendors the app calls, applied here to vendors the
template ships speculatively. The UI test does the same job for components, where the drift is toward a
house design system nobody asked the framework for.

**Tradeoff.** Some genuinely useful vendor integrations stay out of the template even though building
them would be easy, because a second worked example of an already-demonstrated class is repetition, not
coverage. See `docs/app-coverage-gaps.md` for the doctrine's origin and worked application.

## Fakes over emulators — hermetic dev ✅

**Principle.** `pnpm dev` runs entirely on fake adapters with seeded data — no docker, no network, no
credentials, boots in seconds. Fakes beat emulators (LocalStack and friends) because they are faster,
deterministic, and we control them. One real-engine contract suite in CI keeps the fakes honest.

**Why.** Every docker container and live-service dependency in the dev loop taxes every iteration, for
every developer and every agent. Determinism also makes tests trustworthy.

**Tradeoff.** Fakes can drift from real behavior — mitigated by running the _same_ suite against the real
engine. Here, `pnpm test:contract` runs the identical row-level-security proofs on real Postgres (embedded
binaries locally, a service container in CI); if the fake ever drifts, one of the two runs breaks. keel's
own fixture runs there too, in a database of its own, which is how a driver-level difference between the
engines (a `date` column read back as a different value on each) is caught the same way.

## LLM stubbing — record / replay by default ✅

**Principle.** The default LLM fake is record/replay: capture real model responses once into versioned
fixtures, then replay them deterministically. Tiering — fixtures for everyday dev and _all_ tests; the real
API (cheap, fast models) when actively working on an AI feature; a local model only as an optional offline
adapter. **Demo mode is always canned.**

**Why.** Dev, demo, and test want determinism, speed, and zero setup; local models provide none of those,
plus worse quality. Canned demos never lose "live-demo roulette."

**The request side is caught too.** The fake adapter writes every request it is sent (purpose, system,
messages, and a tool loop's tool definitions) to `.data/llm-requests/` before it looks up a fixture, the
way the fake email adapter catches a send. A fixture proves what the app does with an answer; the catch
proves what the app put into the prompt — including for a request that matches no fixture. A world reset
clears it and a snapshot carries it.

**Tradeoff.** Fixtures must be re-recorded when prompts or models change — a one-command chore (`pnpm
llm:record` / `.claude/commands/record-fixtures.md`), with the diff reviewed like any other change. See ADR
[0009](adr/0009-llm-anthropic.md).

**Tool-using conversations replay the same way, split honestly.** A fixture entry for a tool loop
(`runToolLoop`) records the model's turns — text and `tool_use` requests — but never the tool
_results_: those always come from a live call to the app's `execute` closure against whichever
world is running, replay included. Canning a tool result would let a fixture assert a fact about
the world a later seed or edit no longer makes true; this way the model's words are canned but its
tool effects are always real.

## Demo mode is a first-class product artifact ✅

**Principle.** Demo mode is a build flag that runs the _real_ app on fakes with a curated seed dataset and
deterministic AI, deployed at its own URL. That one artifact is the stakeholder demo, the E2E fixture,
new-hire onboarding, and the sales tool for prospective tenants. It can never rot into a second product to
maintain, because it **is** the product with adapters swapped.

**Why.** A demo built as a separate throwaway always drifts from reality; a demo that is the product with
fakes swapped in is always current for free.

**A demo must start INSIDE a story, not build one ✅.** For most of this repo's life the example app
booted empty: every card said "nothing here yet", and the tour was "click each card and watch it fill".
That demos the SCAFFOLD, not the product — and it hides everything that only shows up in a world with
history in it (a queue with an overdue item, a decision waiting on someone, a piece of async work that
already came back). The seed is therefore a CORPUS, not a name list: `packages/seed` carries product
rows alongside the tenants and people, ages are relative to boot so the world never looks like a
fixture from a fixed date, and the framework seeder hands off to an optional app hook
(`appSeedRows`, ADR-0012) so those rows come back after a Simulator world reset. The static twin seeds
itself from the same corpus, because a `file://` bundle that opens on an empty desk is a parity gap,
not a physics one.

**The example app should be a believable PRODUCT, not a coverage harness ✅.** Every framework
capability needs a caller, but a caller named `notes` in "Alpha Organization" teaches nothing about
what the capability is FOR. `apps/showcase` is a support desk: email opens a ticket, a ticket escalates
to another team, a diagnostic bundle goes to an outside analyzer, and a decision leaves the building as
a signed webhook. Two corollaries the desk made concrete. First, **a registry with one member proves an
extension point exists, never that it composes** — so each of them has a second member chosen to differ
in the thing that matters (a job that calls a different port; a tool that takes model-supplied input; a
notification addressed to a person instead of a team's managers), never a copy of the first. Second, an
**ability rule with no route is a rule nobody has exercised** — `Ticket: update|delete` existed from the
day the subject was registered with no HTTP surface behind it, and only writing the routes proved the
model worked.

**This scaffold goes one step further.** Beyond the server demo build (`pnpm build:demo`), there is a
single-file **`file://` static demo** (`pnpm build:demo-static` → `apps/showcase/dist-demo/index.html`): the same
router-agnostic screens over in-memory fakes, inlined into one HTML file that runs from disk with no server
at all. It is the most portable and most demanding proof that the ports boundary holds — Simulator, the
whole simulated-world panel described next, is walkable there too.

**The static demo maintains feature parity — always.** Every feature ships its in-memory twin in the same
change: the same router-agnostic components driven by in-memory state instead of server routes. The static
demo degrades only where physics forbid — no server means no real HTTP or byte downloads, no filesystem
means Snapshots cannot SAVE (reset and the demo presets still work: they are scripts, not files) — and every such degrade is noted where it happens. Pure world _logic_ (flags,
held jobs, advancing state) is never a physics degrade: if it can run in memory, the twin runs it. An empty
tab in the flagship portable demo would undermine the very proof it exists to make. The budget guard
(`scripts/check-demo-size.mjs`) keeps parity honest: hand-built twins over vendored libraries, per the
react-email precedent.

**The simulated world has its own surface: Simulator ✅.** The fakes don't just stub vendors — together they
simulate the world _around_ the app: the other users, their inboxes, the state of the whole set. Simulator is
that world's UI: a collapsible panel docked beside the app (simulated mode only, 404 in real builds), skinned so it
reads as "not the product." _Cast_ switches you between people instantly, restoring where each of them last
was — including invited-but-unregistered people, whose inbox you can read before they have an account (a
signed-out main pane is their "desktop," and clicking the invite in their mail walks the real accept flow).
_Mail_ is a per-person inbox over the caught-email store, with a "compose inbound" affordance and the
cross-tenant world inbound list stacked above it — the receiving half of the same surface, not
a new tab, since an inbound message is world-initiated the way Hooks/Jobs are, not person-owned;
_Messages_ (fake SMS) is the
cross-tenant view of the fake SMS catch-store — a sibling tab to Mail, not a Mail channel-filter (SMS has
no subject/HTML to render), read-only with no clear control (a Snapshots reset wipes it); _Events_ carries
the technical proofs — plus a
read-only "audit trail" section beneath them, the durable per-tenant record of who did what,
distinct from the dev telemetry above it; _Errors_ carries the technical proofs;
_Jobs_ is the cross-tenant view of every job's status timeline, with a "run pending jobs" control for the
`jobs-held` world flag, plus (recurring work) a schedule list and a world-clock offset — advance
+1h/+1d/+1w, run due now, reset — that drains due `job_schedules` on every move; the offset is stored in
a Snapshots-covered `.data/` file and applied only in simulated mode, so a real build always runs on real time;
_Hooks_ (outbound webhooks) is the cross-tenant view of every org's webhook endpoints and their
deliveries, with the signed body/header inspectable per delivery, a per-endpoint failure toggle, and a
"deliver due now" control that drains on the same ticks as Jobs' schedule runner;
_Actors_ (below) runs simulated counterparties that drive that same job timeline
autonomously; _Snapshots_ snapshots and restores the entire world — world state is `.data/`, so a snapshot is a
directory copy — and loads the app's **demo presets** (below), plus an **Agreements** section (access gates): every tenant's agreements with
acceptance tallies and a version-bump control that re-arms the gate for everyone still on an older
version, the same "section, not a new tab" call the Events audit trail made. One surface serves demo'ers
and developers alike: the friendly skin is what a stakeholder
watches, the truthful port data underneath is what the developer needs. Gating is by mode, not role — in
simulated mode every credential is one click away, so role gates there were friction, not protection (see the
decision log). Future world surfaces belong in this panel; Jobs, Actors, and Messages (fake SMS)
are the worked examples of the pattern.

**Actors: from fake adapters to a fake world with inhabitants ✅.** Every fake up to this point impersonates
a vendor the app calls _out_ to (Clerk, S3, Mailgun, Anthropic) — a world built entirely on outbound fakes
has nothing that calls back _in_, so an async workflow just sits at `queued` with nobody to advance it.
Simulator's **Actors** tab closes that gap: simulated counterparties (a bundle analyzer, a partner desk)
run as independent client-side processes, in same-origin iframes, autonomous by default with pause/step
(mounted from page load and kept running whatever the panel shows — the world's `actors-held` flag pauses them),
and they talk to the app only over the surfaces a genuine counterparty would use — `/api/service/*` polls
and `/api/webhooks/*` POSTs, real inbound requests, never an in-process shortcut. A handful of mode-gated
`/api/simulator/actors/*` routes give them a god's-eye work queue and produce the artifact a completion
needs, but the state transitions themselves are the same calls a real service would make. This is the
fakes doctrine's philosophical ceiling: a fake world doesn't just stand still and answer outbound calls —
it can act on its own.

**Tours: the world's narrative, next to the world's state ✅.** A snapshot snapshots what the world IS; a
**tour** is its temporal sibling — a scripted walkthrough that drives the running app for a watcher, with
narration, starting from a world it declares (`'reset'`, a demo preset, or — on a server only — a saved
snapshot). The engine is the framework's
(`packages/keel/src/demo-static/tour/`): a ghost cursor that glides to real elements, fires real clicks,
types character by character, and drives Simulator itself through the panel's own controls; the Tours tab
sits beside Snapshots and disappears entirely for an app that registers none. Each tour is APP content on the
seam (`@app-config/tours`), narration included, because what a walkthrough SAYS is product vocabulary.

The reason to build this rather than record a video is the same reason demo mode is the product with
fakes swapped in: **a recording is stale the moment a screen changes, and a tour is not.** Two rules make
that true. Every submission fires on the watcher's Next, never on a timer, so a tour is paced by the
person watching and can be stopped and poked at on any step — the thing a video can never be. And every
tour is run to its last step in CI (`pnpm e2e:demo-static`), where a target the script cannot find is
recorded rather than swallowed and the run report has to come back clean: a tour that runs end to end IS
an e2e walkthrough, so a screen change that breaks the story fails the build instead of embarrassing
someone in front of a stakeholder. That gate is what makes it safe to email `dist-demo/index.html` to
someone and let them press Start.

**Presets: starting points every host can load ✅.** A saved snapshot is a binary copy of `.data/`, so it
restores only where there is a server to copy it into. A **demo preset** is the other representation —
the seed plus a script of world operations (`keel/core/presets.ts`: invite, inbound email, feature flag, holding one
Simulator actor, and whatever kinds the app adds, each naming its actor and team) and an optional viewpoint — which each host replays its own way: the
server through the same code the product runs (`keel/server-lib/demo-presets.ts`, sharing
`sendOrgInvite` with the org route and the intake with the inbound webhook), the `file://` twin through
its in-memory world, one step per commit so each step sees the world its predecessor left. So a preset
works in `dist-demo/index.html`, and a tour may start from one on every host; `'reset'` → preset →
saved snapshot is the one resolution order (`resolveWorldStart`), and saving a snapshot under a reserved
name is refused so it can never mean two worlds. Preset content is app vocabulary, registered on its
own seam module, `@app-config/presets` (one file per preset; a preset may `extends` one other, single
inheritance), and every registered preset is held at build time to what the product itself would allow
(`presetProblems`, run as seam conformance under every app) — a preset is a
shortcut to a world someone could have clicked together, never a back door into one they could not.
The operation kinds are a registry keel and the app both extend: each kind is a pure definition plus a
server half and a static half that never share a module, and an app entry with keel's kind name replaces
keel's. An app kind calls the same named core function its route calls — the showcase's `ticket.assign`
step and its ticket PATCH route both call `applyTicketChanges` — so a script step and a click cannot
drift apart. The
viewpoint rides along as **who the restorer sits down as**, not as captured state: it is a per-browser
cookie and the world is shared, so loading a preset signs in only the browser that loaded it.

Three boundary rules keep Simulator honest. **Feedback stays inside Simulator** — transient confirmations
render as a notice overlay anchored to the panel's bottom edge (absolute, so a notice never shifts the
panel's own scroll), with a pulsing pill badge when collapsed, never as app-level toasts, and product copy
never references the panel (it ships in real mode, where Simulator doesn't exist). **Real builds ship zero
Simulator client code** — the layout dynamic-imports the glue only in simulated mode (the
`/api/simulator/*` handlers still compile into the server artifact; their first-line 404 gate is the
containment there). **The components stay router-agnostic and vendor-free** — which is exactly what made the
extraction cheap when it came: the panel now lives in the framework package
(`packages/keel/src/components/simulator/`, ADR-0012), so a second app inherits the whole simulated
world for free rather than re-deriving it. A shape worth knowing for future surfaces: per-person world state today is
mail + continuity (last path, active tenant, mail-seen), while Events/Errors/Snapshots are global — a
genuinely per-person surface would sketch a "person's desktop" the People could one day drill into (see
`.claude/future-tasks/persons-desktop.md`). The first candidate to land, SMS, took the global shape instead — the fake
channel is a flat catch-store with no per-recipient inbox to browse the way mail has — so that
reorganization still awaits a channel that is actually per-person.

**Tradeoff.** Keeping the curated seed and deterministic responses current is real work — small, and worth
it. See ADRs [0006](adr/0006-isomorphic-core.md) and [0011](adr/0011-email-mailgun.md).

## Multi-tenancy — the cheap 20% now, the expensive 80% later ✅

**Principle.** Adopt the cheap 20% from the first migration: a `tenant_id` on every table, every
tenant-scoped query forced through one enforced path (Postgres row-level security), per-tenant config and
branding loaded from a record, and no code path anywhere that assumes a single tenant. Explicitly defer the
expensive 80% until a second tenant is real: provisioning UI, per-tenant custom domains, cross-tenant
linking, tenant-level governance, isolation audits.

**Why.** The cheap 20% is near-zero cost adopted at schema birth and a painful rewrite if retrofitted — the
classic one-way door. No early slice needs the expensive 80%.

**Keep-honest trick.** A second, fake tenant exists in tests from day one and the E2E suite runs against
both, so any accidental single-tenant assumption breaks a test the day it's written. Multi-tenant shaped,
single-tenant operated. See ADR [0004](adr/0004-tenancy-rls.md); the one enforced path is `db.withTenant()`
(raw `getDb()` in request paths is lint-banned).

**Teams — the in-tenant layer, one door in.** A tenant stays the ambient, separately-branded site — never
user-switchable in product UI. Inside it, an org (product copy: "team") is the collaboration grouping a
user belongs to, mapping 1:1 to a Clerk Organization, with role evaluated per-org membership; the header
switcher moves between teams, never tenants. Team-scoped data (e.g. a desk's tickets) filters at the app level inside
`withTenant` — RLS itself stays tenant-only, because a team is a collaboration boundary, not a hostile one.
Crossing tenants has no product UI at all; in simulated mode it's a Simulator-only capability (becoming a person
whose home tenant differs), never a second door into the app. See ADR-0003 and ADR-0004.

**Within a team: `authorize()`, not just role rank ✅.** `withTenant` enforces the hostile tenant boundary at
the database; `authorize()` (`packages/keel/src/authz/authorize.ts`) is the analogous single choke point
for the friendlier boundary inside it. Every mutation resolves a subject (`{type, orgId, ownerId}`) and calls
one function that either allows the action or throws `ForbiddenError` → 403. The rule table
(`packages/keel/src/core/abilities.ts`, pure `packages/keel/src/core`, shared verbatim by the server
and the static demo twin) is deny-by-default and org-scoped: role alone (`canManageOrg`) still gates coarse,
whole-route decisions via `requireRole`, but resource-level decisions — can THIS user create THIS ticket in THIS
org — go through the ability layer instead of a rank check. A build-time scan (`authorized-mutations.test.ts`)
makes skipping the choke point loud: every mutating route must call `authorize(...)` or carry a justified
exemption, the same discipline `withTenant`'s lint ban on raw `getDb()` gives the tenant boundary. Team-scoped
data isn't always single-sided either: a subject can name both a `requesterOrgId` and a `responderOrgId`
instead of one `orgId`, so the same row is visible to — and actionable by — two different teams with different
powers (`escalations`, migration 1002, is the reference; see ADR [0004](adr/0004-tenancy-rls.md)).
And denial isn't the only shape of "no": `authorize()` denies one action, while an **access gate**
(`packages/keel/src/core/gates.ts`) blocks or advises across a scope _with a resolution flow_ —
accept the new ToS version, verify your email, enroll MFA — the interstitial-and-resolve class that agreements
demonstrate and future riders (ADR 0003's deferrals, billing entitlements) plug into.

## The verify gate — quality rides the pipeline ✅ / eval harness 🧭

**Principle.** One command — `pnpm verify` — blocks every change: typecheck, lint, unit, hermetic E2E
(including tenant isolation), and the demo build. Quality gates ride the pipeline _per change_ rather than
a batched freeze week. Every PR also uploads a static-demo build of that change, so a human can click
through the change in isolation before merge and by the time code reaches staging it has passed
everything a freeze week would check.

**🧭 The eval harness** is the same idea for AI behavior, and is _intended, not yet built here_: a versioned
dataset of real inputs, expected properties of good output (rubrics, golden examples), and automated
scoring — deterministic checks where possible, LLM-as-judge with a rubric where judgment is needed — run in
CI on every prompt, model, or pipeline change. It turns "did this AI change get better or worse?" into a
score and a diff instead of anecdotes. Without it, every prompt tweak is a silent gamble and demo-day
regressions are how you find out. **Still 🧭 — no harness runs today, and no placeholder package pretends
otherwise — but the on-ramp is already in the tree and worth knowing about before you invent a dataset
format.** The conversation-shaped LLM fixtures (above) ARE the dataset shape: each entry in
`apps/showcase/fixtures/llm/<purpose>.json` pairs an input (`request`: system + messages + tools) with the
expected model behavior (`conversation`: the recorded tool-call and text turns). A harness reads those
entries as cases, replays them through the `llm` port — fixtures locally, the real adapter in scheduled CI
once an API key exists (cutover row `llm-key`) — and asserts properties of the run: that the model called
the tool it should have, that the final text satisfies a rubric. Build it when a product LLM feature makes
the question real; do not build it before.

**Tradeoff.** A strong per-PR gate demands fast, hermetic tests — which the fakes provide. A slow or flaky
gate gets bypassed, so guard its speed.

## Environments — and why there is no standing QA environment 🧭

The intended topology (local pieces exist today; the full cloud shape is the `infra/` CDK draft plus the
`.github/workflows/` checks):

| Environment          | What it is                           | Data / auth                       | Status |
| -------------------- | ------------------------------------ | --------------------------------- | ------ |
| Local dev            | `pnpm dev` on fakes                  | Seeded, dev-auth people           | ✅     |
| Local real           | `pnpm dev:real`                      | Dev cloud resources, dev IdP      | ✅     |
| PR preview (default) | Static demo build, a CI artifact     | Self-seeded, deterministic; no DB | ✅     |
| PR preview (real)    | Full ephemeral stack, labeled PRs    | Ephemeral DB, dev IdP             | 🧭     |
| Staging              | Persistent, production-shaped        | Seeded + accumulated test data    | 🧭     |
| Demo                 | `pnpm build:demo`; URL is a cutover  | Curated seed, canned AI           | ✅     |
| Production           | The real thing, isolated AWS account | Real users, production services   | 🧭     |

**No standing QA environment, on purpose.** QA rides the pipeline: `pnpm verify` and (later) the eval
harness block every PR, and the clickable build is the `static-demo` artifact CI attaches to each run —
download `index.html`, open it, click. It is a downloadable file today, not a URL: hosting it per PR is
the `deploy-pipeline` cutover row, and nothing here pretends otherwise. When someone genuinely needs a
QA-style environment — exploratory testing, a walkthrough of unmerged work — an _ephemeral_ preview is that
environment, created on demand and destroyed at merge. Ephemeral beats standing: a standing QA box
accumulates mystery state and becomes the "works in QA, fails in staging" generator.

**Hard boundaries.** Production sits alone in its own account; lower environments share a non-prod account.
No production data ever flows into lower environments — seed data is the fixture everywhere else. Analytics
collect in staging and production only.

## Services and workers — the one-app default 🧭

**Principle.** Prefer one app, one repo, one pipeline, for longer than intuition suggests. When work does
outgrow a request/response app, most of it still isn't a separate _application_:

- **Workers** are the same codebase with different entry points (queue/event consumers), deployed from the
  same repo and pipeline, sharing the ports, the domain core, and `pnpm verify`.
- **Batch / data pipelines** produce _artifacts_ (tables, files, embeddings), not runtime services the app
  calls — which also makes them trivially seedable as fakes.

Extract a genuinely separate service only when _forced_ by scaling profile, security boundary, team
ownership, or release cadence — never by taste or by an ecosystem's default (e.g. reaching for a separate
Python service when TypeScript behind a port does the job).

**The `apps/` tree is not an exception to this** (ADR-0007), and the distinction is worth being exact
about, because "there are two directories under `apps/`" reads like the doctrine already lost. This
principle is about resisting a second **deployable** — its own pipeline, its own failure modes, its own
hermetic-dev problem. `apps/starter` is none of those: it is not deployed, has no pipeline, shares the one
verify gate, and exists to be _compiled_, because a framework with one consumer cannot tell you which of
its assumptions are assumptions. An adopter ends up with exactly one app, by running a supported command.
The test to apply when this comes up again: **is the second directory a second product?**

**The two invariants still govern on arrival.** Anything extracted must run hermetically on a laptop and
ship its fake in the same PR. Async features actually demo _better_ faked: the jobs port's fake ✅ is an
in-process queue that completes inline by default, with a `jobs-held` world flag and Simulator's Jobs tab
"run pending jobs" control for when the choreography should be visible — a "time jumps forward" demo
fires the canned effect instead of waiting on a real queue. A smaller on-ramp sits before either: routine
post-response side effects (the canonical one, notification email) go through `deferAfterResponse()` ✅
instead of running inline on the request — real mode via Next's `after()`, simulated mode inline for
determinism — and the same call site becomes `jobs.start(...)` if the work ever truly outgrows the
request/response lifecycle. "A service is just another port" is what keeps the demo build honest no
matter how many services eventually sit behind it.

**Why.** Microservices-by-default multiplies plumbing and breaks hermetic dev. This is Conway's law managed
deliberately: one pod, one app. The realistic mature shape is one repo containing the app, a worker fleet,
and a batch pipeline — a very different thing from a microservices estate, on purpose.

**The realtime-collab recipe — the canonical forced extraction, written down so it never gets built
early 🧭.** Multiplayer editing over WebSockets is the textbook case where a second service is genuinely
forced: serverless request/response cannot hold a socket. The shape that satisfies both halves of the
doctrine is a sidecar (Hocuspocus/Yjs, persisting CRDT state to its own table) **plus a single-user flag
that bypasses the service entirely** and is exercised in production-adjacent preview environments. That
degrade path is the load-bearing fact: **single-user editing is a viable product mode**, so the hermetic
scaffold never needs the service at all. The recipe, when an app on this template is genuinely forced
here:

1. **Single-user is the default and the fake.** The editing feature ships first with no service — plain
   state, last-write-wins, one user per document. `pnpm dev`, demo mode, and the static demo run this
   mode forever; the collab service is an enhancement the app degrades _from_, never a dependency it
   breaks without.
2. **The service is another counterparty, not another app.** Shared code lives in
   `packages/keel/src/core`/shared packages; the service verifies the app's session tokens on
   connect (the service-auth seam is the worked precedent for a second verifier of app-issued
   credentials); its persistence is its own table(s), migrated by the same migrator.
3. **The seam is a port.** The app reaches collab state through a `collab` port sized to the app; real
   adapter = the sidecar's client, fake adapter = the single-user store, vendor SDKs fenced into
   adapters as always.
4. **Simulator gets the world surface.** Simulated _other editors_ are actors — iframe processes
   driving the real WebSocket surface with pause/step, exactly the Actors-tab pattern. The fake world
   with inhabitants extends to collaborators.
5. **Cutover rows, not blockers.** The service's deploy target, domain/cert, and scaling profile are
   checklist rows; until they're done the degrade mode carries every environment.

Do not build any of this speculatively. The trigger is a real app with a real collab requirement; until
then this recipe is the whole deliverable — the one-way door (committing to a second service) stays
closed, and the two-way door (this written plan) cost a page.

## Where to record what

- **[ADRs](adr/)** — the one-way-door decisions. Accepted, not relitigated in routine work; challenge one
  only with new information, and record the outcome as a superseding ADR. An ADR body is a dated record:
  amend it by appending a dated addendum, never by editing what it said.
- **`docs/decision-log.md`** — unplanned decisions a plan didn't anticipate, with rationale.
- **`docs/build-notes.md`** — lessons and gotchas learned while building ("wish someone had told me").
- **`.claude/future-tasks/`** — designed-but-unbuilt work, one file per item with an `index.md` carrying
  priorities. These are agent-actionable, so they live beside the other agent state rather than in the
  human doc set. Mark one RESOLVED with an implementation summary rather than deleting it.
- **This document** — the operating philosophy behind all of the above.
- **`CLAUDE.md`** — the terse, enforceable rules that fall out of this philosophy; read it first when
  writing code.

Doctrine is gated: `tests/docs/doc-paths.test.ts` fails the build if a doctrine doc cites a repo path that
does not exist. The dated records are exempt, because rewriting an entry to match
today's tree would falsify it — see [docs/README.md](README.md) for the full split.
