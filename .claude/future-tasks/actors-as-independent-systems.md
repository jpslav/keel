# Actors: stop unmounting mid-run, and decide whether any should leave the page

**Priority:** P2 · **Status:** open

## The narrower, concrete gap: actors stop the moment you look away

**SHIPPED 2026-10-03** (`feat/simulator-people-orgs-actor-keepalive`): `SimulatorExtraTab.keepMounted`,
set on the showcase's Actors tab through `@app-config/simulator`. Lazy, then sticky — nothing mounts
until the tab is first opened (so specs and tours still start in a quiet world), and from then on the
content stays mounted, hidden, through tab switches and collapse; the collapsed panel keeps its
hidden aside in the DOM at the same tree position, because an iframe that moves reloads. The rule is
`packages/keel/src/components/simulator/tab-mount.ts`; the e2e proof is the last test in
`apps/showcase/tests/e2e/destructive/actors.spec.ts`. The line references below describe the code as it
was. Only the larger question that follows is still open.

An actor's tick loop is a `setTimeout` chain owned by a mounted React component (`ActorShell`,
`packages/keel/src/components/simulator/actor-shell.tsx`). Today it stops far more easily than
"close the browser tab": `simulator-panel.tsx` renders a host-built tab's content only while that
tab is the active one (`packages/keel/src/components/simulator/simulator-panel.tsx:613`, "App tabs
render their host-built content here... each only while active — so a tab's live content (iframe /
mounted node) unmounts with it"), and collapsing the panel returns an entirely different element
tree (`simulator-panel.tsx:347`, `if (collapsed) { ... }`) that skips the active-tab render
altogether. So an actor's loop dies the instant the viewer switches to another Simulator tab, or
collapses the panel — not only when they navigate away or close the tab.

**Need:** once the Actors tab has been opened, its actors should stay mounted (and ticking) across a
tab switch and a panel collapse, not just while that specific tab is on screen. This is additive to
the existing component — no architecture change, just not re-deriving "is this tab active" as the
mount condition for something that is supposed to keep running in the background.

## The larger, open design question: should any actor run off the page at all

Separately — and this is a real design decision, not a small addition — a derived app whose actors
model independent external systems (counterparties that poll or claim work and deliver results on
their own schedule, not a schedule tied to _any_ page being open) would need an actor able to run
with no page open at all, and such actors instanceable per organization: one running instance per
external-system/org pairing, each with its own loop.

This is not what Keel's actors are designed to be today, and that is stated, not merely assumed:
`docs/development-approach.md:299` says Simulator's actors "run as independent client-side
processes, **in same-origin iframes**, autonomous by default with pause/step" — on a server host
that's a real iframe (`apps/showcase/src/app/[locale]/simulator/actors/[actor]/actor-host.tsx`,
"the full-page host behind an actor iframe"); the static/served demo mounts the same `ActorShell`
inline instead, with no iframe and no server to run anything on. **A `file://` static host can never
run a server-side loop at all** — there is no server. So "server-side, page-independent actors"
is at most a server-host-only capability, and adopting it is a doctrine change
(`development-approach.md`'s own framing would need an ADR addendum), not an extension of the
current design.

It's also worth separating two things that sound alike: per-organization actor _registration_
already exists — an app can register one actor per org today in `@app-config/actors`
(`apps/showcase/src/app-config/actors.ts` splits its two actors' job pools by org by exactly this
convention). What doesn't exist is registering (or instancing) an actor for an organization created
at _runtime_, after the app's config was written — that's the part a static per-org registry can't
cover, and the part a dynamic/server-side model would actually need to add.

The driver/tick split in `actor-runtime.ts` already keeps the tick logic transport- and UI-agnostic,
which is what would make a non-page-scoped driver plausible without rewriting the tick logic itself
if this is ever taken on — but deciding whether to take it on, and what happens to the existing
page-scoped `ActorShell`/log UI if some actors move off the page, comes first.

Evidence: `packages/keel/src/components/simulator/simulator-panel.tsx:613` (tab content unmounts when
inactive) and `:347` (collapse skips the active-tab render), `packages/keel/src/components/simulator/actor-shell.tsx`
(the `setTimeout` chain, gated on the component staying mounted), `packages/keel/src/components/simulator/actor-runtime.ts`
(the driver/tick separation), `apps/showcase/src/app-config/actors.ts` (today's static per-org
registration), `apps/showcase/src/app/[locale]/simulator/actors/[actor]/actor-host.tsx` (the
server-host iframe), `docs/development-approach.md:299` (the stated client-side/iframe design actors
have today).
