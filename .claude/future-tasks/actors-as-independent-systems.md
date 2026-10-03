# Actors as independent external systems, not browser-page loops

**Priority:** P2 · **Status:** open

The Simulator Actors tab's tick loop is a `setTimeout` chain owned by a mounted React component
(`ActorShell`, `packages/keel/src/components/simulator/actor-shell.tsx`) — it runs only while that
page is open in a browser tab, on no schedule but "whoever left the tab open". The actors it drives
already divide the job pool by organization, but only by convention in app config
(`apps/showcase/src/app-config/actors.ts`: one actor scoped to one org, another handling every other
org) — the runtime itself has no notion of "one instance per org".

**Need:** a derived app whose actors model independent external systems — counterparties that poll or
claim work and deliver results on their own schedule, not a schedule tied to a page staying open —
needs those actors able to run independent of any open page, and instanceable per organization: one
running instance per external-system/org pairing, each with its own loop, rather than one shared
in-page loop iterating every org's pool together.

This is a design decision, not a small addition: where the loop runs (a server process vs. today's
page-scoped component), how many instances exist and what keys one to an org, and what happens to the
existing page-scoped `ActorShell`/log UI once the loop itself can move off the page — a read-only view
onto a server-side log, or an additive server-side mode alongside the page-scoped one kept for local
dev. The driver/tick split in `actor-runtime.ts` already keeps the tick logic transport- and
UI-agnostic, which is what makes a non-page-scoped driver plausible without rewriting the tick logic
itself — the gap is only in where that logic gets invoked from and on what schedule.

Evidence: `packages/keel/src/components/simulator/actor-shell.tsx` (the `setTimeout` chain, gated on the
component staying mounted), `packages/keel/src/components/simulator/actor-runtime.ts` (the
driver/tick separation that would carry over), `apps/showcase/src/app-config/actors.ts` (today's
org-split-by-convention, not by runtime).
