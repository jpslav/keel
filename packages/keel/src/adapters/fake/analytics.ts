import { existsSync, readFileSync } from 'node:fs'
import { appendFile } from 'node:fs/promises'
import path from 'node:path'
import { flags as appSimulatorFlags } from '@app-config/simulator'
import type { AnalyticsPort } from '../../ports/analytics'
import { writeJsonAtomicSync } from './atomic-write'
import { recordLastPath } from './simulator'
import { dataDir } from './data-dir'

/**
 * Persists every capture() into .data/analytics/events.jsonl (append-only — an event log is
 * high-volume, unlike the one-file-per-item email catch store) and flags into
 * .data/analytics/flags.json. The Simulator panel's Events tab (GET /api/simulator/events)
 * renders both; Playwright asserts against them.
 */

export interface CapturedEvent {
    id: string
    at: string
    event: string
    properties?: Record<string, unknown>
    distinctId?: string
}

/**
 * The framework's own feature flags: 'demo-banner' gates the demo banner; 'jobs-held' keeps submitted
 * jobs 'queued' for the operator to step forward. Both are framework flags and stay HERE (ADR-0012).
 */
const frameworkFlags = ['demo-banner', 'jobs-held']

/**
 * The feature flags the Simulator Snapshots tab can toggle — the ONE list both simulator routes read
 * (events feeds the toggle list, flags validates writes) so they can never drift. Composed from the
 * framework flags and any app-registered ones (src/app-config/simulator.ts `flags`, EMPTY today — the
 * seam is proven live by this composition, not by a demo entry).
 */
export const KNOWN_FLAGS = [...frameworkFlags, ...appSimulatorFlags.map((flag) => flag.id)]

let counter = 0

function eventsFile(): string {
    return path.join(dataDir('analytics'), 'events.jsonl')
}

function flagsFile(): string {
    return path.join(dataDir('analytics'), 'flags.json')
}

export const fakeAnalytics: AnalyticsPort = {
    async capture(event, properties, distinctId) {
        const captured: CapturedEvent = {
            id: `${Date.now()}-${(counter++).toString().padStart(3, '0')}`,
            at: new Date().toISOString(),
            event,
            properties,
            distinctId,
        }
        await appendFile(eventsFile(), `${JSON.stringify(captured)}\n`)
        // Simulator continuity piggyback: a signed-in page_view is exactly "where this person
        // last was", so the fake adapter records it here — keeping the beacon route port-pure
        // instead of importing simulator internals from product code.
        if (event === 'page_view' && typeof distinctId === 'string' && typeof properties?.path === 'string') {
            recordLastPath(distinctId, properties.path)
        }
    },
    async isFlagEnabled(flag, defaultValue = false) {
        const flags = readFlags()
        return flag in flags ? flags[flag]! : defaultValue
    },
}

/** Simulated-mode-only surface for the Simulator Events tab (NOT part of AnalyticsPort). */
export function listCapturedEvents(): CapturedEvent[] {
    const file = eventsFile()
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as CapturedEvent)
        .sort((a, b) => (a.id < b.id ? 1 : -1))
        .slice(0, 500)
}

export function readFlags(): Record<string, boolean> {
    const file = flagsFile()
    if (!existsSync(file)) return {}
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, boolean>
}

export function setFlag(flag: string, enabled: boolean): void {
    const flags = readFlags()
    flags[flag] = enabled
    writeJsonAtomicSync(flagsFile(), flags)
}
