# A hand-written `.mjs` in the generated styles directory escapes every lint fence

**Priority:** P3 · **Status:** open
**Found by:** review round 2 of `fix/lint-fence-gaps` (2026-11-16), and again in round 1 of
`fix/lint-import-fences-getdb-default`. It is documented in `docs/recipes/app-owned-adapter.md`'s Limits.

## What is true

`eslint.config.mjs` ignores `apps/*/src/styles/generated/**/*.{mjs,d.ts}` globally: that is what Panda's
codegen writes there, and its output does not lint. The directory is committed, and `panda codegen` runs
without `--clean`, so a hand-written `.mjs` file in it survives regeneration and is never linted. A route can
import it, so it can import a vendor SDK, read `process.env` or take the raw db handle with a green `pnpm lint`.
It is the one tracked place under `apps/*/src` where that holds. A hand-written `.ts` or `.js` file there IS
linted: #38 narrowed the ignore from the whole directory to the two extensions Panda writes.

Nothing in the tree does this today.

## What done looks like

One of these, decided with whoever owns the styling setup:

- Lint Panda's output instead of ignoring it, with only the fence rules on (`keel/no-raw-db-handle`, the
  vendor bans, the process.env ban) and the style rules off. The output must pass them already; check that
  first.
- Or narrow the ignore to the exact paths Panda writes (`helpers.mjs`, and `css/`, `jsx/`, `patterns/`,
  `tokens/`, `types/`). A hand-written `.mjs` beside them in one of those subdirectories would still pass, so
  this only shrinks the gap.
- Or move the generated directory out of `apps/showcase/src`. That changes every styled-system import, so it
  is the largest change.

Whichever it is, add a case to `tests/lint/extensions.test.ts` that a hand-written `.mjs` in that directory
is fenced, and see it fail first.
