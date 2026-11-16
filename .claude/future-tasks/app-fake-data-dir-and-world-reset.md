# An app-owned fake cannot persist under `.data/` and be reset with the world

**Priority:** P3 · **Status:** open, and blocked on a real need
**Found by:** the app-owned adapters slice, 2026-11-16 (`feat/app-owned-adapters`).

## What is true

keel's fakes persist under `.data/<dir>/` through `dataDir()` (`packages/keel/src/adapters/fake/data-dir.ts`)
and the atomic writer, and the Simulator's reset and snapshots cover exactly the directories listed in
`LIVE_DIRS` (`packages/keel/src/adapters/fake/simulator-admin.ts`). An app-owned fake
(`apps/<app>/src/adapters/fake/`) can use neither:

- `dataDir()` and the atomic writer are not in keel's `exports` map, so `keel/public-surface` refuses them.
- `LIVE_DIRS` is a closed literal. A directory the app wrote would survive a world reset that the rest of
  the world does not, and would be missing from every snapshot.
- The fake may not read `process.env` (lint), so it cannot find `APP_DATA_DIR` itself either.

`docs/recipes/app-owned-adapter.md` §4 therefore tells adopters to keep fake state in memory, pinned on
`globalThis`, or in the app's own tables (the database is a live dir). Both work for a store the app can
rebuild. Neither suits a fake that must survive a dev-server restart and also reset with the world.

## Sketch, if a real app needs it

Publish `dataDir()` and `writeJsonAtomic` as a small `keel/adapters/fake/persist` subpath, and let the app
register extra live dirs through the `simulator` seam (`liveDirs: readonly string[]`, empty by default),
which `simulator-admin.ts` appends to `LIVE_DIRS` after checking for collisions with keel's names. Prove it
in the fixture: one fixture-only fake writing to its own dir, and a reset/snapshot test that sees it cleared
and restored.
