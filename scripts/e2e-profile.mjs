// Where the e2e wall clock actually goes.
//
// Committed rather than run ad hoc because the alternative is optimising by intuition: the suite has
// 70 server tests across two projects, and "which ones are slow" is not guessable from reading them —
// the expensive ones are expensive for different reasons (cold route compiles, real polling, repeated
// UI sign-ins) and only a ranking separates those.
//
// Usage, from an app directory:
//   node ../../scripts/e2e-profile.mjs --project=chromium
//   node ../../scripts/e2e-profile.mjs --project=destructive --workers=1 --no-deps
//
// Any argument is forwarded to `playwright test`, so this profiles whatever you can already run.
// Reads Playwright's own JSON report, so the numbers are Playwright's, not a wrapper's stopwatch.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const TOP_N = 20

const scratch = mkdtempSync(path.join(tmpdir(), 'e2e-profile-'))
const reportFile = path.join(scratch, 'report.json')

try {
    // The JSON reporter goes to a FILE, not stdout: stdout also carries `[WebServer]` output and the
    // dev server's own logging, which would make the report unparseable.
    const run = spawnSync('pnpm', ['exec', 'playwright', 'test', '--reporter=json', ...process.argv.slice(2)], {
        stdio: ['inherit', 'inherit', 'inherit'],
        env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile },
    })

    let report
    try {
        report = JSON.parse(readFileSync(reportFile, 'utf8'))
    } catch {
        console.error('\ne2e-profile: no parseable JSON report — the run probably failed before reporting.')
        process.exit(run.status ?? 1)
    }

    /** @type {{ title: string, file: string, duration: number, status: string }[]} */
    const tests = []
    const walk = (suite, file) => {
        const here = suite.file ?? file
        for (const spec of suite.specs ?? []) {
            for (const test of spec.tests ?? []) {
                // Retries produce several results; charge the test the total, since that is the wall
                // clock the run actually spent on it.
                const duration = (test.results ?? []).reduce((sum, r) => sum + (r.duration ?? 0), 0)
                tests.push({ title: spec.title, file: here ?? '?', duration, status: test.status ?? '?' })
            }
        }
        for (const child of suite.suites ?? []) walk(child, here)
    }
    for (const suite of report.suites ?? []) walk(suite, undefined)

    const wall = report.stats?.duration ?? 0
    const summed = tests.reduce((sum, t) => sum + t.duration, 0)
    const slowest = [...tests].sort((a, b) => b.duration - a.duration).slice(0, TOP_N)
    const byFile = new Map()
    for (const t of tests) byFile.set(t.file, (byFile.get(t.file) ?? 0) + t.duration)

    const secs = (ms) => `${(ms / 1000).toFixed(1)}s`
    const pct = (ms) => (summed > 0 ? `${((ms / summed) * 100).toFixed(1)}%` : '—')

    console.log(`\n${'='.repeat(78)}`)
    console.log(`wall clock ${secs(wall)} across ${tests.length} tests (summed test time ${secs(summed)})`)
    // Summed > wall means parallelism is working; summed ≈ wall means it is not.
    console.log(`parallel speedup ${wall > 0 ? (summed / wall).toFixed(1) : '—'}x`)
    console.log('='.repeat(78))

    console.log(`\nslowest ${Math.min(TOP_N, slowest.length)} tests`)
    for (const t of slowest) {
        console.log(`  ${secs(t.duration).padStart(7)}  ${pct(t.duration).padStart(6)}  ${t.file} › ${t.title}`)
    }

    console.log('\nby spec file')
    for (const [file, ms] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${secs(ms).padStart(7)}  ${pct(ms).padStart(6)}  ${file}`)
    }
    console.log()

    process.exit(run.status ?? 0)
} finally {
    rmSync(scratch, { recursive: true, force: true })
}
