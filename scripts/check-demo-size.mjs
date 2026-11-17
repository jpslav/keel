// Guard the file:// single-file demo artifact against silent bloat (vendored libs, base64 blobs, a seam
// import that drags a server graph in).
//
// THE BUDGET IS THE APP'S OWN NUMBER, passed as the first argument from the app's package.json
// (`check:demo-size`); this script holds none. One shared number sized for the largest app is not a gate for
// the others, since a small app could double and still pass. Resolved from the working directory, not from
// this file: the script is repo-scoped but the artifact is app-scoped (apps/<app>/dist-demo), so each app runs
// it from its own directory (`pnpm --filter <app> check:demo-size`).
//
// THIS FILE IS KEEL'S, and an upstream merge (ADR-0013) may change it, so nothing in it is ever yours to edit.
// To change an app's number, re-set it in that app's package.json and record what changed and why in
// apps/<app>/DEMO-SIZE.md beside it, in its own commit: what grew, by how much, and how much headroom you left
// on purpose. (The starter ships one, saying what its number is for and how it got there.)
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

/** Headroom, as a fraction of the budget, under which the gate still passes but says so. */
const THIN_HEADROOM = 0.02

if (process.argv[2] === undefined) {
    console.error(
        "check-demo-size: pass this app's budget, in bytes, as the first argument: the `check:demo-size` script in " +
            'its package.json.',
    )
    process.exit(1)
}
const budget = Number(process.argv[2])
if (!Number.isFinite(budget) || budget <= 0) {
    console.error(`check-demo-size: budget argument must be a positive number, got ${process.argv[2]}`)
    process.exit(1)
}
const file = path.join(process.cwd(), 'dist-demo', 'index.html')
const size = statSync(file).size
if (size > budget) {
    console.error(`${file} is ${size} bytes — ${size - budget} over the ${budget} byte budget.`)
    console.error(
        "That number is this app's own: the argument of `check:demo-size` in its package.json. " +
            'First find what grew (see WHEN IT GOES RED in scripts/check-demo-size.mjs). If the growth is intentional, ' +
            "raise the budget in its own commit and say what grew in the app's DEMO-SIZE.md.",
    )
    process.exit(1)
}
const headroom = budget - size
// Rounded DOWN, so a headroom under THIN_HEADROOM never prints as the threshold itself ("2.0%" beside a warning).
const percent = (Math.floor((headroom * 1000) / budget) / 10).toFixed(1)
console.log(`${file}: ${size} / ${budget} bytes — OK (${headroom} bytes, ${percent}% headroom)`)
if (headroom / budget < THIN_HEADROOM) {
    const message =
        `only ${headroom} bytes (${percent}%) of headroom left under the ${budget} byte budget: the next feature may ` +
        "tip it. Look at what grew while that is cheap (scripts/check-demo-size.mjs says how); raise this app's " +
        'budget, in its own commit, only for a feature.'
    console.warn(`check-demo-size: ${message}`)
    if (process.env.GITHUB_ACTIONS) console.log(`::warning title=demo size headroom::${message}`)
}
