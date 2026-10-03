# Prebaked demo snapshots

**Priority:** P2 · **Status:** open

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
