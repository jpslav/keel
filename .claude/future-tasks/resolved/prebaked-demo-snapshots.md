# Prebaked demo snapshots

**Was:** P2 · **Status:** RESOLVED 2026-10-03 (`prebaked-demo-presets`) — as declarative **demo presets**, not
prebaked `.data/` copies. Implementation summary at the end; the original task text is kept above it.

Snapshots are directory copies of `.data/`, so canonical demo starting points are cheap to ship: a script
(`pnpm snapshots:seed`?) that builds 2–3 checked-in worlds by driving the fake adapters directly, then saving
through `saveSnapshot()`:

- `fresh` — seed baseline
- `mid-demo` — a pending invite + unread mail + a couple of tenant rows
- `multi-tenant` — both tenants busy

Demo prep becomes "restore mid-demo" instead of five minutes of clicking.

**Watch out:** snapshots embed pglite binary state, so generate them at install/demo-prep time rather than
committing `.data` bytes to git.

**Cross-reference: the consumer has landed; only the prebaked worlds are missing.** Tours shipped, and a
tour already declares the snapshot it starts from — `snapshot?: string` in
`packages/keel/src/demo-static/tour/contracts.ts`, restored before step 1. Today the only value every
host can honour is `'reset'` (the seeded world); a server host can additionally name a snapshot someone
saved by hand. So this task is no longer speculative and no longer conditional on anything else: the
socket exists, and building these worlds is what gives a tour author something worth plugging into it
other than "the seed" or a world they clicked together and hoped nobody deletes.

**Extends to: the viewpoint, and every host, not only the Next server.**

A snapshot today is `.data/`-only — `LIVE_DIRS` in `packages/keel/src/adapters/fake/simulator-admin.ts`
is what `saveSnapshot`/`restoreSnapshot` actually copy — and the signed-in viewpoint lives outside
`.data/` entirely, as a cookie (`writeViewpointCookie`, read/written from
`apps/showcase/src/app/api/simulator/viewpoint/route.ts`). Saving and restoring a snapshot carries the
world but not who was looking at it.

**This matters less for tours than it sounds.** A tour can already set the viewpoint as an ordinary
step: `apps/showcase/src/app-config/tours.ts` has a step whose `advance` is a click on
`[data-testid="people-person-admin"]`, with its own comment noting that becoming someone is a world
change the tour already waits on like any other. So a tour wanting "start on a pending review, signed
in as the reviewer" can already script that as its first step rather than needing it baked into the
snapshot. Where viewpoint-in-snapshot actually earns its keep is manual demo prep — "restore
`mid-demo`" landing you signed in as the right person with no extra click — and there it runs into a
real tension worth stating rather than glossing over: the viewpoint is a per-browser cookie, but the
world a snapshot restores is shared state. "Capture the viewpoint in the snapshot" needs an answer for
what that means when two browsers restore the same snapshot and each had a different person signed
in before the restore.

**The every-host half is a different representation, not just different wiring.** `SnapshotsApp`
renders its save/restore/delete controls only when the host supplies a `snapshots` prop
(`packages/keel/src/components/simulator/snapshots-app.tsx` — "when `snapshots` is undefined the
caller has no server-side snapshot store to talk to (the static shell), so the snapshot half doesn't
render"), and the runtime creation route (`apps/showcase/src/app/api/simulator/snapshots/route.ts`)
404s wherever `isSimulated` is false. `useTours`' own doc comment is explicit about the asymmetry this
causes: "`'reset'` is the snapshot every host has... a server host may also restore a named snapshot"
(`packages/keel/src/demo-static/tour/use-tours.tsx`) — a static/served demo host has no `onSnapshot`
that can do anything with a named snapshot at all. But the reason isn't only missing wiring: a saved
snapshot is a directory copy that includes pglite's own binary state (see "Watch out" above), and
there is no server process on a `file://` static host to restore a binary directory _into_ — a static
host has nothing `cpSync` could target. So a snapshot that works on every host can't be today's
`.data/` copy exposed more widely; it needs a declarative representation instead — a seed plus a
scripted sequence of operations each host can replay in its own way (the static shell driving its
in-memory world, a server driving pglite) — closer to what a tour's own `script`/`advance` steps
already are than to a filesystem snapshot.

So the prebaked worlds this task already asks for need a second half to be useful everywhere a tour
can run: a declarative preset representation (and a replay path) that a host with no server — the
static/served demo — can also honour. Once that exists, tours starting from a preset on every host is
just wiring `onSnapshot` on that host too, not a separate task.

## Implementation summary (2026-10-03)

Built as the review concluded: **declarative presets every host replays**, not binary snapshots exposed
more widely. No `pnpm snapshots:seed` and no committed worlds. The decision log entry "Demo presets are
declarative…" records each unplanned call.

- **Contract** — `packages/keel/src/core/presets.ts`: `DemoPreset` (`id`, `titleKey`/`summaryKey` into
  the app catalog, optional `viewpoint`, `operations`). It also defines the operation vocabulary
  `invite` / `inbound` / `flag`, each naming its actor and team. `resolveWorldStart` gives the one
  resolution order (`'reset'` → preset → saved snapshot). `presetProblems` holds a preset to the
  product's own rules.
- **Registration** — `presets` on `@app-config/simulator`: the showcase registers `fresh`, `mid-demo`
  and `multi-tenant`; the starter registers `[]` (no presets section, one type import); keel's fixture
  registers `busy-harbor` in its own vocabulary. A seam-conformance test
  (`server-lib/demo-presets-seam.test.ts`) runs under every app and the fixture.
- **Server replay** — `packages/keel/src/server-lib/demo-presets.ts` behind
  `apps/showcase/src/app/api/simulator/presets/route.ts`. It resets the world, invites through
  `sendOrgInvite` (extracted from the org route, now shared), sends inbound mail through the framework
  intake, sets flags through the fake analytics store, then signs in the restorer with `devSignIn`.
- **Static replay** — `world.applyPreset` in `packages/keel/src/demo-static/world.ts`. It replays
  through the twins, one step per commit, so each step sees the world its predecessor left.
- **Viewpoint** — who the restorer sits down as, applied only to the browser that loaded the preset.
  Other browsers keep theirs. That is the answer to the per-browser-cookie vs shared-world tension.
- **Surfaces** — the Snapshots tab lists presets on both hosts (`preset-load-<id>`). A tour's
  `snapshot` may name a preset on both hosts. Saving a snapshot under a reserved name is refused. A
  tour start a host cannot honour is a recorded miss. The second showcase tour, `invite-from-preset`,
  starts from `mid-demo` and runs in the `file://` CI walkthrough.
- **Proofs** — the keel replay test against the fixture; the static-shell and destructive server e2e
  for loading presets; the tours e2e on both hosts. Each new gate was watched failing first: a broken
  preset, and a tour naming a server-only snapshot.

## Later the same day: what the summary above no longer says (2026-10-03)

Three follow-up slices on `integration/demo-presets` superseded parts of the summary above.

- **Registration:** presets moved off `@app-config/simulator` onto their own seam module, `@app-config/presets`, one file per preset. They gained single-inheritance `extends`, flattened by `expandPreset`.
- **Operations:** the operation set stopped being a fixed `invite` / `inbound` / `flag`. It is now a registry keel and the app both extend:
    - each kind is a definition (Standard Schema args) plus a server half plus a static half;
    - an app kind may replace one of keel's;
    - named results (`as` / `consumes`) let a later step act on a row an earlier step created;
    - the showcase's `ticket.assign` calls the same `applyTicketChanges` its PATCH route does.
- **Actors:** a preset can hold one Simulator actor with the framework kind `actor.hold`.

The decision log carries each step: "Presets move to their own seam module…", "Preset operations become a registry…" and "Holding one actor is a preset operation kind…". So do the ADR-0012 addenda.
