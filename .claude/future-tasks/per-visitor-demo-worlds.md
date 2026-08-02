# Per-visitor worlds for the public demo

**Priority:** P3 · **Status:** blocked on the `demo-url` cutover row

For the `demo-url` cutover row: treat each visitor's demo as its own world, keyed by an unguessable id in a
cookie — shareable by sharing the link/cookie value, GC'd after N idle days.

Mechanically the fake stores become world-scoped:
`.data/worlds/<id>/{auth,emails,analytics,pglite,storage,simulator}` instead of one global `.data`, with
`dataDir()` resolving the world from the request.

Pieces:

- world-id cookie middleware (simulated mode only)
- `dataDir(worldId, ...)` threading — every fake adapter already goes through `data-dir.ts`, so the seam
  exists
- lazy per-world seed on first touch
- an idle-sweep job
- a "share this world" affordance in Simulator

Until then the public demo is one shared world — see the cutover row's exposure warning: the Simulator API
is unauthenticated by design, so any visitor can read all typed mail, become admin, or reset the shared
world mid-demo.
