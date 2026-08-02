// Prints one port, so package.json scripts can say `--port "$(node ../../scripts/print-port.mjs showcase)"`.
//
// A separate file from ports.mjs on purpose. The usual "am I the entry point?" check compares
// `process.argv[1]` against `import.meta.filename`, and ports.mjs cannot use `import.meta` at all —
// Playwright compiles it to CommonJS as part of loading playwright.config.ts, where that is a syntax
// error. Splitting the executable half off is cheaper than a heuristic, and it means importing the
// port logic can never accidentally print to stdout.
import { portFor, SERVICE_NAMES } from './ports.mjs'

const service = process.argv[2]
if (!service) {
    console.error(`usage: node scripts/print-port.mjs <${SERVICE_NAMES.join('|')}>`)
    process.exit(1)
}

try {
    // `process.stdout.write` of a STRING, never `console.log` of a number.
    //
    // Playwright injects FORCE_COLOR=1 into every webServer process it spawns. `console.log` of a
    // NUMBER routes through util.inspect, which then colours it — the bytes become
    // `\e[33m3240\e[39m`. That renders as a clean "3240" in a terminal AND in a log file, so the
    // corruption is invisible; but `$(...)` captures the escape codes too, and `next dev --port`
    // then fails parseInt with the maddening message "'3240' is not a non-negative number".
    // Strings are never colourised, so this cannot recur.
    process.stdout.write(`${portFor(/** @type {Parameters<typeof portFor>[0]} */ (service))}\n`)
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
}
