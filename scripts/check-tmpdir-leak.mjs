// Run a test command with a private TMPDIR and fail if a scratch directory made through
// tests/support/tmp-dir.ts is still there afterwards.
//
//     node scripts/check-tmpdir-leak.mjs vitest run --config …
//
// Every test temp directory is created under os.tmpdir(), which reads $TMPDIR on POSIX and $TEMP/$TMP
// on Windows; the child gets all three, so the redirect holds on either. Pointing it at a fresh per-run directory therefore puts ALL of the run's scratch space in one place we
// own, which makes the leak check exact: any marker file left in it is a directory the helper's
// cleanup did not remove. A before/after count of markers in the SHARED tmpdir would instead
// false-positive whenever another worktree runs its tests at the same moment — and this repo is
// worked in from several worktrees at once.
//
// The run directory is removed unconditionally at the end, so even a raw `mkdtemp` that slipped past
// the lint rule (and leaves no marker) cannot accumulate across runs.
import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { constants, tmpdir } from 'node:os'
import path from 'node:path'
import { TMP_DIR_MARKER_SUFFIX } from '../tests/support/tmp-dir-marker.mjs'

const [command, ...args] = process.argv.slice(2)
if (!command) {
    console.error('usage: node scripts/check-tmpdir-leak.mjs <command> [args...]')
    process.exit(2)
}

/** Run the command to completion; resolves to its exit status (128 + n when it died on a signal). */
function runChild(env) {
    return new Promise((resolve) => {
        // stdio inherited and no shell. A terminal Ctrl-C reaches the child through the shared process
        // group; the explicit forwarding below covers a signal sent to this process alone (a CI
        // cancel, `kill <pid>`), and having a listener at all is what stops node from exiting on the
        // signal before the `finally` in main() has removed the run directory.
        const child = spawn(command, args, { stdio: 'inherit', env })
        const forward = (signal) => () => child.kill(signal)
        const onInt = forward('SIGINT')
        const onTerm = forward('SIGTERM')
        process.on('SIGINT', onInt)
        process.on('SIGTERM', onTerm)
        const done = (status) => {
            process.off('SIGINT', onInt)
            process.off('SIGTERM', onTerm)
            resolve(status)
        }
        child.on('error', (error) => {
            console.error(`check-tmpdir-leak: could not run \`${command}\`: ${error.message}`)
            done(1)
        })
        child.on('close', (code, signal) => done(code ?? 128 + (constants.signals[signal] ?? 1)))
    })
}

async function main() {
    const runDir = mkdtempSync(path.join(tmpdir(), 'keel-test-run-'))
    try {
        const status = await runChild({ ...process.env, TMPDIR: runDir, TEMP: runDir, TMP: runDir })
        if (status !== 0) return status

        // Deliberately not in a try/catch: a missing run dir means something removed it under us,
        // and that must fail loudly rather than read as "no leaks".
        const leaked = readdirSync(runDir).filter((name) => name.endsWith(TMP_DIR_MARKER_SUFFIX))
        console.log(`check-tmpdir-leak: ${leaked.length} unremoved test temp dir(s)`)
        if (leaked.length === 0) return 0
        console.error(
            `check-tmpdir-leak: ${leaked.length} test temp dir(s) outlived the run:\n` +
                leaked.map((name) => `  ${name}`).join('\n') +
                '\nA marker survives only when its directory could not be removed or the cleanup hook ' +
                'never ran. See tests/support/tmp-dir.ts.',
        )
        return 1
    } finally {
        rmSync(runDir, { recursive: true, force: true })
    }
}

process.exit(await main())
