---
description: Add a demo-preset operation kind (definition + server half + static half) through the app-config seam
---

Add a demo-preset operation kind for: $ARGUMENTS

A demo preset (`packages/keel/src/core/presets.ts`) is the seed plus a script of world operations that
every host replays: the server through the same code the product runs, the `file://` demo through its
in-memory twin. keel ships four kinds — `invite`, `inbound`, `flag`, `actor.hold`. An app adds its own (the showcase's
`ticket.assign` is the worked example), and an app kind with keel's kind NAME replaces keel's.

Every kind is **three files that never import each other's halves**, in
`apps/showcase/src/app-config/presets/operations/<kind>/`:

| File            | Holds                                                               | Imported by                               |
| --------------- | ------------------------------------------------------------------- | ----------------------------------------- |
| `definition.ts` | args type + Standard Schema (Valibot) + `check` + `consumes` — PURE | `presets.ts` (both hosts, seam tests)     |
| `server.ts`     | the server half: `ServerPresetOperationHandler<Args>`               | `preset-operations.ts` ONLY (server-only) |
| `static.ts`     | the static half (a factory over the composition root's rows)        | the static composition root ONLY          |

**The hard rule: never import a server half from anything the static demo bundles.** `server.ts`
reaches `keel/adapters/index`, which starts with `import 'server-only'`, and through it pglite; the static demo is one
single-file bundle, and either of those inside it stops it loading from `file://`. That is why the server
half registers on its own server-only seam module and never on `presets.ts`. After building, check:
`grep -c pglite apps/showcase/dist-demo/index.html` must print 0.

1. **Name the kind** `<noun>.<verb>` in the app's vocabulary (`ticket.assign`). Decide what it EXPLICITLY
   names: an actor (`by`, a seed person) and a team (`org`), always — never "whoever is signed in"; a
   preset replays before anyone is. If it acts on something an earlier step created, it takes a NAME,
   not an id (step 4).
2. **The definition** (`definition.ts`), copying
   `apps/showcase/src/app-config/presets/operations/ticket-assign/definition.ts`:
    - export the args interface and `export type <Kind>Operation = PresetOperationOf<'<kind>', <Args>>`;
    - `args`: the SHAPE, as a Valibot `v.strictObject(...)`, so a misspelled argument fails the gate rather than being dropped (any Standard Schema library works; it must
      validate synchronously). Types only — a value the product would refuse is a rule, not a shape;
    - `check(args, world, earlier)`: the rules the product's route would enforce, as plain sentences.
      Ask the SAME question the route's `authorize(...)` asks, through `defineAbilitiesFor`
      (`keel/core/abilities`), as the explicit actor acting in the explicit team. `world` is derived from
      the seed by the seam test; if you need a field it lacks, add it to `PresetWorld` and derive it in
      `packages/keel/src/server-lib/demo-presets-seam.test.ts`, never hand-list values;
    - `consumes(args)`: every argument that is a NAME from an earlier step's `as`.
3. **Register the definition** in `apps/showcase/src/app-config/presets.ts`: add it to
   `appPresetOperations` and its operation type to the `AppPresetOperation` union.
4. **Named results.** A step may say `as: 'refund'`; the id of what it created is bound to that name for
   the rest of the replay. A half that creates something returns `{ ref: id }` (return nothing / `{}`
   otherwise); a half that consumes a name calls `ctx.refs.resolve(name)`. The gate requires every
   consumed name to be bound by an EARLIER step, and each name to be bound once.
5. **The server half** (`server.ts`), copying `.../ticket-assign/server.ts`: resolve the team with
   `resolvePresetOrg` (`keel/server-lib/preset-operations`), look the row up ORG-SCOPED the way the
   route does, then call the **same named domain operation the route calls**. If the route still holds
   that logic inline, extract its post-authorize body into a function in `apps/showcase/src/domain/`
   first (`applyTicketChanges` in `apps/showcase/src/domain/ticket-changes.ts` is the pattern): an
   operation both callers call, not an event one of them posts. The route keeps parsing, validation,
   session, resolution and `authorize(...)`. Throw `NotFoundError` for anything the world does not have.
   Register it in `apps/showcase/src/app-config/preset-operations.ts`.
6. **The static half** (`static.ts`), copying `.../ticket-assign/static.ts`: a factory taking this
   render's rows and setter, returning a `StaticPresetOperationHandler<Args>`
   (`keel/demo-static/contracts`). Call the static twin of the same domain operation (extract it from the
   card's inline handler if needed — `apps/showcase/src/demo-static/ticket-changes.ts`), passing the
   explicit actor, and route the audit and notification through `ctx.recordAudit(entry, scope)` and
   `ctx.notifyMemberOf` — never `world.logAudit`, which writes as the signed-in person. Return `false`
   when the world cannot perform the step. Register it in `apps/showcase/src/demo-static/app.tsx`
   under `useDemoWorld({ presetOperations: { … } })`.
7. **Use it** in a preset under `apps/showcase/src/app-config/presets/`, and update that preset's summary
   copy in BOTH catalogs and the runbook paragraph (`docs/runbooks/demo.md`) if it is a shown preset.
8. **Gates**: `pnpm exec vitest run packages/keel/src/server-lib/demo-presets-seam.test.ts` (definitions vs
   server halves, every preset replayed on the server); the static-shell e2e loads every registered
   preset from `file://` and waits for its "Preset loaded" notice, so a missing static half fails there.
   Assert the kind's visible effect in the preset specs on both hosts. Then `pnpm check:demo-size` and
   `pnpm verify`.

## `--from <keel kind>`: replace one of keel's kinds

To make a preset follow YOUR version of `invite` (a customized invite flow), register an app kind with
keel's name. Start from keel's own three parts and keep the name:

- **Definition**: copy keel's from `packages/keel/src/core/presets.ts` (`inviteOperation`,
  `inboundOperation`, `flagOperation`, `actorHoldOperation`) into `.../operations/<kind>/definition.ts`, keeping `kind`
  identical, and register it in `appPresetOperations`. If your version keeps keel's argument shape,
  leave `AppPresetOperation` alone (keel's `FrameworkPresetOperation` already types that name); if it
  changes the shape, add yours to the union. Change the rules to match your route.
- **Server half**: copy keel's from `packages/keel/src/server-lib/preset-operations.ts` into
  `server.ts`, or WRAP it — `frameworkPresetOperationHandlers.<kind>(args, ctx)` is published there —
  and register it under keel's kind name in `apps/showcase/src/app-config/preset-operations.ts`.
- **Static half**: keel's lives inside `packages/keel/src/demo-static/world.ts` (it touches world state no
  app half can reach), so wrap it instead of copying it: `ctx.framework.<kind>(args, ctx)` runs keel's
  twin, and your half adds what your version does differently. Register it under keel's kind name in
  `presetOperations`.

`packages/keel/test-fixture/app-config/preset-operations.ts` shows a wrapping replacement (`flag`).
