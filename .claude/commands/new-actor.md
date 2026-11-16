---
description: Add a simulated counterparty (Simulator actor) registered through the app-config seam
---

Add a Simulator actor for: $ARGUMENTS

Actors are simulated external counterparties for dev/demo — the actor _runtime_ (shell, iframe
hosting, `packages/keel/src/components/simulator/actor-runtime.ts`) is framework; each actor is app content:

1. **Register** in `apps/showcase/src/app-config/actors.ts`: add `{ id, titleKey, descriptionKey }` to `actors`.
   The keys resolve in the APP catalog's `actors` namespace (`apps/showcase/messages/{en,es}.json`) —
   the host glue translates them and hands the panel finished strings, so a counterparty you invent
   never needs a key in keel's catalog. `ActorId` and `isActorId` derive automatically.
2. **Driver**: add the actor's behavior in
   `apps/showcase/src/app/[locale]/simulator/actors/[actor]/drivers.ts` (what it polls, what buttons it exposes,
   which service/API calls it makes) — `bundle-analyzer` (service-token job runner) and
   `partner-desk` (completion-webhook deliverer) are the two reference shapes.
   **Then wire the driver in, in BOTH hosts — neither is generic, and both fail silently.** Each picks
   its driver by actor id, and an unrecognised id falls through to the builder/`partner-desk` shape
   rather than erroring: `actor-host.tsx` branches on `actor === 'bundle-analyzer'` inside its `tick`
   callback (the live app), and `apps/showcase/src/demo-static/app.tsx` does the same with a
   `id === 'bundle-analyzer' ? serviceTickFn : builderTickFn` ternary (the static twin). No gate
   catches a missing branch: typecheck, lint, knip and the unit suite all stay green while your new
   actor quietly runs someone else's behavior. The page itself genuinely is generic.
3. **Org coupling**: if the actor impersonates a service bound to an org, that slug is app config
   (`analyzerOrgSlug` is the precedent) and must match a `packages/seed` org.
4. **Static twin**: the in-memory driver shapes are framework code
   (`packages/keel/src/demo-static/actor-drivers.ts`) — an actor over the jobs subsystem needs no new
   twin, just a scoped factory call and a tick wired into `actorSlots` in `apps/showcase/src/demo-static/app.tsx`,
   so the `file://` demo can step the same story (static-demo parity is doctrine). A driver over a
   surface keel doesn't own is a new twin beside it.
5. **Holds**: nothing to wire — both hosts already ask the world whether THIS actor is held before every
   autonomous tick (the `actors-held` flag for all of them, a demo preset's `{ op: 'actor.hold', actor: '<id>',
held: true }` for one). The preset gate checks `actor` against the `actors` list you registered in step 1.
6. Exercise it from the Simulator Actors tab (the tab itself is registered via
   `apps/showcase/src/app-config/simulator.ts`; each registered actor becomes a card + slot, titled from your
   registration's keys) and cover the flow in `apps/showcase/tests/e2e/destructive/actors.spec.ts` style. Finish
   with `pnpm verify`.
