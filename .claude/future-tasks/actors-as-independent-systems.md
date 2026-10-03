# Actors: stop unmounting mid-run, and decide whether any should leave the page

**Priority:** P2 · **Status:** open

## The narrower, concrete gap: actors stop the moment you look away

**SHIPPED 2026-10-03**, in two steps. `feat/simulator-people-orgs-actor-keepalive` kept the Actors tab
mounted once opened; `feat/actors-always-on` then made it mount from PAGE LOAD — the counterparties are
part of the world, so they run whether or not anyone opens the tab — and added the world's hold on
them: the showcase's `actors-held` Snapshots flag, which each actor asks before every autonomous tick
(`ActorShell`'s `held` prop; a manual Step ignores it). The rule is
`packages/keel/src/components/simulator/tab-mount.ts`; the e2e proof is the last test in
`apps/showcase/tests/e2e/destructive/actors.spec.ts` (held jobs stay queued while every frame reports
`held`, then drain on release with the panel never opened). The line references below describe the
code as it was.

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

## What is still open

Always-on settles most of what "independent of the page" meant: an actor now runs whenever the app is
open, on BOTH hosts — the static `file://` demo runs the same `ActorShell` inline, with the same
`setTimeout` loop, just not in an iframe. Three narrower questions remain:

1. **Runtime-created organizations.** Per-org actors are expressible today by registering one per org
   in `@app-config/actors`, but not for an org created after the config was written.
2. **Trigger-driven actors.** Today's actors poll. A counterparty that instead WAITS for something —
   the app's outbound webhook delivery, an email — needs the app to deliver to an in-page actor, which
   no host does yet.
3. **Headless, with no browser open at all.** Only a server host could do it, no demo needs it, and it
   contradicts the stated client-side design below; it is the least likely of the three to be worth it.

The original framing follows, kept for the evidence.

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
