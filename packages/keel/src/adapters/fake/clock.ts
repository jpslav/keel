import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomicSync } from './atomic-write'
import { dataDir } from './data-dir'

/**
 * The simulated world's CLOCK OFFSET (simulated-mode only, NOT a port) — the "time control" the backlog
 * left open until a feature needed elapsed time (scheduled work is that feature). It is
 * a single signed millisecond offset added to real wall-clock time to compute the world's "now" for
 * the scheduled-jobs due-scan, so a demo can advance the clock past a schedule's next_run_at and watch
 * it fire without waiting real hours.
 *
 * Stored as `.data/simulator/clock.json`. `simulator` is a LIVE_DIR (packages/keel/src/adapters/fake/simulator-admin.ts),
 * so a Snapshots RESET wipes this file back to zero and save/restore snapshot it with the rest of the
 * world — the "Snapshots reset clears the offset" requirement is satisfied structurally, no extra wiring.
 *
 * REAL MODE NEVER TOUCHES THIS. worldNow() is only ever called behind an `isSimulated` guard (the cron
 * webhook route and the simulated-mode-gated Simulator routes), so the offset is structurally unreachable
 * in a real build — real time is always real time. Same containment shape as the fake-only webhook
 * secret helper pulled into shared glue behind isSimulated (packages/keel/src/service-auth/webhook.ts).
 */
function clockFile(): string {
    return path.join(dataDir('simulator'), 'clock.json')
}

export function readClockOffsetMs(): number {
    const file = clockFile()
    if (!existsSync(file)) return 0
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { offsetMs?: unknown }
    return typeof parsed.offsetMs === 'number' && Number.isFinite(parsed.offsetMs) ? parsed.offsetMs : 0
}

function writeClockOffsetMs(offsetMs: number): void {
    writeJsonAtomicSync(clockFile(), { offsetMs })
}

/** Adds delta ms to the stored offset (advance only ever moves forward in the UI) and returns the new
 *  total. Clamped to non-negative — the world clock never runs behind real time. */
export function advanceClockMs(deltaMs: number): number {
    const next = Math.max(0, readClockOffsetMs() + deltaMs)
    writeClockOffsetMs(next)
    return next
}

/** Back to real time. */
export function resetClock(): void {
    writeClockOffsetMs(0)
}

/** The world's current instant: real time plus the stored offset. Simulated-mode use only. */
export function worldNow(): Date {
    return new Date(Date.now() + readClockOffsetMs())
}
