// Guard the file:// single-file demo artifact against silent bloat (vendored libs, base64 blobs).
// Default budget = the showcase's size at introduction (730502 bytes on 2026-07-18) + ~25% headroom.
// If growth is intentional, raise the budget consciously, in its own commit.
//
// RAISED 2026-07-31, 920000 → 950000, for TOURS: the tour engine (ghost cursor driver, engine hook,
// narration bar, Tours tab) plus the showcase's 16-step walkthrough and its narration in both locales
// cost 25244 bytes, 2.8% of the artifact — 10932 of that is the engine (measured against apps/starter,
// which registers no tours and still passes its own unchanged budget) and ~14300 is the tour itself,
// most of it narration in two locales. That is the one feature whose whole point IS this file: a
// stakeholder who is emailed dist-demo/index.html can now press Start instead of reading a runbook and
// clicking fifteen things in the right order. The new headroom is deliberately thin (~3%) so the next
// growth is again a decision someone has to make on purpose.
//
// Resolved from the working directory, not from this file: the script is repo-scoped but the
// artifact is app-scoped (apps/<app>/dist-demo), so each app runs it from its own directory
// (`pnpm --filter <app> check:demo-size`). A SMALLER app passes its own budget as the first argument
// — one shared number sized for the largest app is not a gate for the others, since a small app
// could double and still pass.
import { statSync } from 'node:fs'
import path from 'node:path'

const DEFAULT_BUDGET_BYTES = 950_000
const budget = Number(process.argv[2] ?? DEFAULT_BUDGET_BYTES)
if (!Number.isFinite(budget) || budget <= 0) {
    console.error(`check-demo-size: budget argument must be a positive number, got ${process.argv[2]}`)
    process.exit(1)
}
const file = path.join(process.cwd(), 'dist-demo', 'index.html')
const size = statSync(file).size
if (size > budget) {
    console.error(`${file} is ${size} bytes — over the ${budget} byte budget.`)
    console.error("If growth is intentional, raise this app's budget (package.json check:demo-size) in its own commit.")
    process.exit(1)
}
console.log(`${file}: ${size} / ${budget} bytes — OK`)
