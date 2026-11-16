import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const flagsFile = path.resolve(__dirname, '../../../.data/analytics/flags.json')

/**
 * Set a persisted Simulator world flag straight on disk (.data/analytics/flags.json) — for a spec's
 * beforeAll/afterAll, where there is no page to call /api/simulator/flags from. Destructive specs use it
 * to hand the shared world back exactly as they found it.
 */
export function setWorldFlag(flag: 'jobs-held' | 'actors-held', enabled: boolean): void {
    const flags = existsSync(flagsFile) ? (JSON.parse(readFileSync(flagsFile, 'utf8')) as Record<string, boolean>) : {}
    flags[flag] = enabled
    mkdirSync(path.dirname(flagsFile), { recursive: true })
    writeFileSync(flagsFile, JSON.stringify(flags, null, 2))
}
