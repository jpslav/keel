# Route glue duplicates per app — a third app breaks the jscpd gate

**Priority:** P2 · **Status:** open — becomes P0 the moment a third app is added
**Found by:** `apps/starter`, 2026-07-31. Recorded in `docs/build-notes.md`.

## Where the gate actually stands (re-measured from `pnpm jscpd`)

`.jscpd.json` sets `threshold: 2`, and the number that threshold gates is **duplicated LINES**, not
tokens — confirmed by running the same scan at `--threshold 0.9` (fails) and `--threshold 1.2` (passes).

| Metric                       | Now                      |
| ---------------------------- | ------------------------ |
| Duplicated lines (**gated**) | 284 / 28,192 — **1.01%** |
| Duplicated tokens            | 2,181 / 144,662 — 1.51%  |
| Clone pairs                  | 25                       |
| Files analyzed               | 281                      |

So the margin is roughly **half the threshold**, not the sliver an earlier draft of this file claimed
(it said "1.91% against a threshold of 2", which matched neither metric). Re-run `pnpm jscpd` before
quoting a number here — it moves with every file added anywhere in `{apps,packages}/*/src`, since the
denominator is the whole scanned tree.

## The clone pairs, from that run

**11 of the 25 pairs are showcase ↔ starter** — the structural per-app duplication this file is about:

- `apps/*/src/app/[locale]/layout.tsx` — the locale layout
- `apps/*/src/app/[locale]/(protected)/layout.tsx` — the protected layout
- `apps/*/src/app/[locale]/(protected)/header-glue.tsx`
- `apps/*/src/app/[locale]/(protected)/dashboard/page.tsx`
- `apps/*/src/app/[locale]/signin/picker-glue.tsx`
- `apps/*/src/app/api/auth/dev-signin/route.ts`
- `apps/*/src/app/api/auth/org/route.ts`
- `apps/*/src/app/api/respond.ts`
- `apps/*/src/components/dashboard-screen.tsx`
- `apps/*/src/demo-static/main.tsx`
- `apps/*/src/app-config/db/migrations/` — the RLS migration boilerplate the docs explicitly tell you
  to copy (showcase `1003_attachments.ts` ↔ starter `1001_items.ts`)

Two corrections to the earlier list. **`api/auth/signout` is no longer a clone pair** — it dropped out.
And four entries it never mentioned are now in the list: the dashboard page, `dashboard-screen.tsx`, the
static-demo entry `main.tsx`, and the locale layout.

The other 14 pairs are NOT per-app glue and are not what this task is about — six are the showcase's
attachments migration matching framework migrations that share the tenant/org column preamble, two are
within the showcase (`api/attachments/[id]/confirm` ↔ `api/tickets/[id]`, and the snapshots
delete ↔ restore routes), and six are internal to keel: one fake ↔ real auth pair, two simulator
prop-interface pairs, one migration pair, and two email-template pairs. Promoting route glue would not
move any of them.

**Nothing is wrong with the code.** The duplication is structural: ADR-0012 records that route files
stay in `apps/*/src/app` forever because Next.js requires it, so every app re-states the same wrappers.

## The trap to avoid

When the gate goes red, the tempting fix is raising the threshold. Don't. Promote the glue into keel as
re-exportable handlers and layouts, so an app's route file becomes a one-line re-export
(`export { GET, POST } from 'keel/routes/auth/org'`). That shrinks each new app _and_ removes the
duplication, where raising the threshold hides both.

Note that each promoted module also needs its `exports` line in `packages/keel/package.json` — adding a
file does not publish it, and `keel/public-surface` enforces that.

**Trigger:** a third app, or jscpd crossing 2% for any other reason. A third app adds roughly another
11 pairs of the same shapes, which is what makes this a when, not an if — but the current 1.01% means
there is real headroom, so this is planning, not firefighting.
