// Guard the file:// single-file demo artifact against silent bloat (vendored libs, base64 blobs, a seam
// import that drags a server graph in). Default budget = the showcase's size (814660 bytes on 2026-11-16)
// + ~3% headroom, rounded up. If growth is intentional, raise the budget consciously, in its own commit,
// with a note here of what grew, by how much, and how much headroom was left on purpose.
//
// THE BUDGET IS EACH APP'S OWN NUMBER, and the two apps hold theirs for different jobs.
// - The showcase's is the FRAMEWORK'S pace-setter: ~3% over what it measures, deliberately thin, so that
//   growth is a decision someone makes on purpose. Every framework screen and twin is in the showcase, so
//   a framework change that costs bytes costs them here first.
// - The starter's is the number an ADOPTER inherits when they keep it (`pnpm init-app`), so it is sized for
//   THEIR growth and not the framework's: room to grow the starter to the size of the showcase, rounded up,
//   before it asks them anything. It still fails on gross bloat, and on the pruning stopping (the number sits
//   below what the starter measured before the CSS was pruned, below). Bloat in the framework of any size
//   shows up in the showcase first, which is why this one can be roomy. It is not a pacing gate; an adopter
//   who wants one sets the number to what their app measures plus the headroom they want.
// After `pnpm init-app --eject-showcase` the showcase is gone and the surviving app's number is the only one that
// matters. It is yours.
// A number is raised or re-based in `apps/<app>/package.json` (`check:demo-size`) or, for the showcase, in
// DEFAULT_BUDGET_BYTES below. Say what changed in the commit and in this header.
//
// HISTORY
// RAISED 2026-07-31, 920000 → 950000, for TOURS: the tour engine (ghost cursor driver, engine hook,
// narration bar, Tours tab) plus the showcase's 16-step walkthrough and its narration in both locales
// cost 25244 bytes, 2.8% of the artifact — 10932 of that is the engine (measured against apps/starter,
// which registers no tours and still passes its own unchanged budget) and ~14300 is the tour itself,
// most of it narration in two locales. That is the one feature whose whole point IS this file: a
// stakeholder who is emailed dist-demo/index.html can now press Start instead of reading a runbook and
// clicking fifteen things in the right order.
//
// RE-BASED 2026-11-16, showcase 950000 → 840000 and starter 880000 → 820000. Since the first commit
// (925623 and 844820 bytes) the demo had grown 18787 on the showcase and 10061 on the starter, to 99.4% of
// its budget, and a starter-derived app with one small screen sat at 99.3% of the starter's. Per merge:
// demo presets (#26) +16924 / +8706, the Simulator's people-and-orgs work (#15) +810 / +769, actors that
// start with the page (#16) +855 / +388, the mechanical bundle (#19) +198 / +198. Two things were removed:
// - 3248 bytes on the starter (493 on the showcase) were incidental. keel's four preset operation
//   definitions were module-level constants, so valibot and four schemas rode in every app's bundle
//   although the demo never validates a preset. They are built by function now, and
//   tests/tooling/static-demo-bundle.test.ts holds it. (An app's OWN definition is not covered: the
//   showcase's `ticket.assign` still carries ~2.8 KB of valibot.)
// - 130247 bytes on the starter (129257 on the showcase) were Mantine's stylesheet. The apps import
//   `@mantine/core/styles.css` whole, 273 KB for ~100 components, and the framework's screens use 33. The
//   static demo's build now drops every rule whose hashed class is in no shipped file
//   (scripts/vite-prune-mantine-css.ts, wired in each app's vite.demo.config.ts): a seventh of the file.
// What stays is the presets themselves: net of the trim ~16.4 KB on the showcase and ~5.5 KB on the
// starter, real code (the static twin's replay, the operation registry, the seam module with `extends`)
// plus its copy and its tour.
// `pnpm build:demo-static`, bytes:       first commit    main before    now        budget    headroom
//   showcase                                925623         944410      814660     840000    25340 (3.0%)
//   starter                                 844820         854881      721386     820000    98614 (12.0%)
// The budgets went DOWN, so the bytes saved are not slack: they are the margin above, on purpose. If the
// pruning or the lazy definitions regress, these numbers turn red, which is the point of them.
//
// The default (the showcase's) is a constant here; a SMALLER app passes its own as the first argument. One
// shared number sized for the largest app is not a gate for the others, since a small app could double and
// still pass. Resolved from the working directory, not from this file: the script is repo-scoped but the
// artifact is app-scoped (apps/<app>/dist-demo), so each app runs it from its own directory
// (`pnpm --filter <app> check:demo-size`).
//
// WHEN IT GOES RED: find what grew before raising anything. `pnpm build:demo-static` prints, per app, how
// much stylesheet the pruning removed; the JS is where features land. Build the previous commit in a
// throwaway worktree and compare `dist-demo/index.html`, or bundle with a recorder plugin that prints each
// module's `renderedLength`: a dependency that arrived (valibot), a seam registry imported into the bundle
// (37% in one commit once, see docs/adr/0012), a base64 asset, a catalog namespace. Fix an incidental cause;
// raise the budget only for a feature.
//
// WHEN IT WARNS: under 2% headroom the script passes and says so (on CI as a workflow annotation too). That is
// the cue to look at what grew while it is cheap, not a failure; it exists because "one dependency bump from
// red" used to be something a person had to notice by measuring.
import { statSync } from 'node:fs'
import path from 'node:path'

const DEFAULT_BUDGET_BYTES = 840_000
/** Headroom, as a fraction of the budget, under which the gate still passes but says so. */
const THIN_HEADROOM = 0.02

const budget = Number(process.argv[2] ?? DEFAULT_BUDGET_BYTES)
if (!Number.isFinite(budget) || budget <= 0) {
    console.error(`check-demo-size: budget argument must be a positive number, got ${process.argv[2]}`)
    process.exit(1)
}
const file = path.join(process.cwd(), 'dist-demo', 'index.html')
const size = statSync(file).size
if (size > budget) {
    console.error(`${file} is ${size} bytes — ${size - budget} over the ${budget} byte budget.`)
    console.error(
        "That number is this app's own (package.json `check:demo-size`; the showcase's is in scripts/check-demo-size.mjs). " +
            'First find what grew (see WHEN IT GOES RED in that file). If the growth is intentional, raise the budget in ' +
            'its own commit and say what grew.',
    )
    process.exit(1)
}
const headroom = budget - size
const percent = ((headroom / budget) * 100).toFixed(1)
console.log(`${file}: ${size} / ${budget} bytes — OK (${headroom} bytes, ${percent}% headroom)`)
if (headroom / budget < THIN_HEADROOM) {
    const message =
        `only ${headroom} bytes (${percent}%) of headroom left under the ${budget} byte budget: the next feature may ` +
        "tip it. Look at what grew while that is cheap (scripts/check-demo-size.mjs says how); raise this app's " +
        'budget, in its own commit, only for a feature.'
    console.warn(`check-demo-size: ${message}`)
    if (process.env.GITHUB_ACTIONS) console.log(`::warning title=demo size headroom::${message}`)
}
