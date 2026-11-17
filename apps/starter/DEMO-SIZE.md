# Demo size budget

The static demo (`pnpm build:demo-static`) is one HTML file you can hand someone, and `pnpm check:demo-size`
fails if it grows past a byte budget. The number is the argument of `check:demo-size` in this app's
`package.json`, and it is this app's own: `scripts/check-demo-size.mjs` is keel's, holds no number, and says
what to look at first when the gate goes red.

## What this number is for

The starter ships it roomy on purpose, sized for an app's own screens and not as a pacing gate: room to grow
the starter to the size of keel's showcase, rounded up, before it asks anything of you. It still fails on gross
bloat, and on the pruning of Mantine's stylesheet stopping (the number sits below what the starter measured
before the CSS was pruned, below). Bloat in the framework of any size shows up in the showcase first, which is
why this one can be roomy. If you want a pacing gate, set the number to what your app measures plus the
headroom you want.

## How to change it

Re-set the number in `package.json` and add an entry under "Changes" below in the same commit: what grew or
shrank, by how much, and how much headroom you left on purpose. Newest first. Do not record it in
`scripts/check-demo-size.mjs`: that file is keel's, and an upstream merge will change it.

## Changes

None yet.

## How it started (keel's history for the starter)

Re-based 2026-11-16, 880000 → 820000. Since the first commit (844820 bytes) the starter's demo had grown
10061 bytes, and a starter-derived app with one small screen sat at 99.3% of the budget. Per merge: demo
presets (#26) +8706, the Simulator's people-and-orgs work (#15) +769, actors that start with the page (#16)
+388, the mechanical bundle (#19) +198. Two things were removed:

- 3248 bytes were incidental. keel's four preset operation definitions were module-level constants, so valibot
  and four schemas rode in every app's bundle although the demo never validates a preset. They are built by
  function now, and `tests/tooling/static-demo-bundle.test.ts` holds it.
- 130247 bytes were Mantine's stylesheet. The apps import `@mantine/core/styles.css` whole, 273 KB for ~100
  components, of which the demo's bundle reaches 33. The static demo's build now drops every rule whose hashed
  class is in no shipped file (`scripts/vite-prune-mantine-css.ts`, wired in each app's `vite.demo.config.ts`):
  14-15% of the file.

What stays is the presets themselves: net of the trim about 5.5 KB on the starter, real code (the static
twin's replay, the operation registry, the seam module with `extends`) plus its copy and its tour.

`pnpm build:demo-static`, bytes: 844820 at the first commit, 854881 before the re-base, 721386 after it. The
budget is 820000, which leaves 98614 bytes (12.0%).

The budget went DOWN, so the bytes saved are not slack: they are the margin above, on purpose. If the pruning
or the lazy definitions regress, the number turns red, which is the point of it.
