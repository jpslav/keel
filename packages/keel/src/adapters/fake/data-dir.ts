import { mkdirSync } from 'node:fs'
import path from 'node:path'

/** All fake-adapter state lives under .data/ (gitignored). Tests point APP_DATA_DIR at a tmp dir. */
export function dataDir(...segments: string[]): string {
    const base = process.env.APP_DATA_DIR ?? path.join(process.cwd(), '.data')
    const dir = path.join(base, ...segments)
    mkdirSync(dir, { recursive: true })
    return dir
}
