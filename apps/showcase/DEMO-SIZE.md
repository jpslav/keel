# Demo size budget

The static demo (`pnpm build:demo-static`) is one HTML file you can hand someone, and `pnpm check:demo-size`
fails if it grows past a byte budget. The number is the argument of `check:demo-size` in this app's
`package.json`, and it is this app's own: `scripts/check-demo-size.mjs` is keel's, holds no number, and says
what to look at first when the gate goes red.

## What this number is for

The showcase's budget is the framework's pace-setter: about 3% over what it measures, deliberately thin, so that
growth is a decision someone makes on purpose. Every framework screen and twin is in the showcase, so a
framework change that costs bytes costs them here first.

## How to change it

Re-set the number in `package.json` and add an entry to the history below in the same commit: what grew, by how
much, and how much headroom you left on purpose. Newest first. Do not record it in
`scripts/check-demo-size.mjs`: that file is keel's, and an upstream merge will change it.

## History

### Re-based 2026-11-16, 950000 → 840000

Since the first commit (925623 bytes) the demo had grown 18787 bytes, to 99.4% of its budget. Per merge: demo
presets (#26) +16924, the Simulator's people-and-orgs work (#15) +810, actors that start with the page (#16)
+855, the mechanical bundle (#19) +198. Two things were removed:

- 493 bytes were incidental: keel's four preset operation definitions were module-level constants, so valibot
  and four schemas rode in every app's bundle although the demo never validates a preset. They are built by
  function now, and `tests/tooling/static-demo-bundle.test.ts` holds it. (An app's OWN definition is not
  covered: the showcase's `ticket.assign` still carries about 2.8 KB, its definition and valibot's schema
  functions.)
- 129257 bytes were Mantine's stylesheet. The apps import `@mantine/core/styles.css` whole, 273 KB for ~100
  components, of which the demo's bundle reaches 33. The static demo's build now drops every rule whose hashed
  class is in no shipped file (`scripts/vite-prune-mantine-css.ts`, wired in each app's `vite.demo.config.ts`):
  14-15% of the file.

What stays is the presets themselves: net of the trim about 16.4 KB on the showcase, real code (the static
twin's replay, the operation registry, the seam module with `extends`) plus its copy and its tour.

`pnpm build:demo-static`, bytes: 925623 at the first commit, 944410 before the re-base, 814660 after it. The
budget is 840000, which leaves 25340 bytes (3.0%).

The budget went DOWN, so the bytes saved are not slack: they are the margin above, on purpose. If the pruning
or the lazy definitions regress, the number turns red, which is the point of it.

### Raised 2026-07-31, 920000 → 950000, for tours

The tour engine (ghost cursor driver, engine hook, narration bar, Tours tab) plus the showcase's 16-step
walkthrough and its narration in both locales cost 25244 bytes, 2.8% of the artifact: 10932 of that is the
engine (measured against the starter, which registers no tours and still passed its own unchanged budget) and
about 14300 is the tour itself, most of it narration in two locales. That is the one feature whose whole point
IS this file: a stakeholder who is emailed `dist-demo/index.html` can now press Start instead of reading a
runbook and clicking fifteen things in the right order.
