import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { presets } from '@app-config/simulator'
import { isReservedWorldStartName, WORLD_START_NAME_PATTERN } from '../../core/presets'
import { ForbiddenError, NotFoundError } from '../../ports/errors'
import { writeFileAtomicSync, writeJsonAtomicSync } from './atomic-write'
import { dataDir } from './data-dir'
import { closeFakeDb } from './db'

/**
 * Snapshots: world reset + named snapshots (simulated-mode-only, NOT a port). Every fake adapter already
 * writes its state to a flat-file directory under `.data/` — auth (sessions' signing secret,
 * profile overrides, invites, the dynamic-person overlay), emails, analytics, pglite, storage,
 * and Simulator's own continuity state — so the simulated world's state IS the filesystem, and
 * "reset" / "save a snapshot" / "restore a snapshot" are directory operations, not application
 * logic: `rmSync`/`cpSync` over those directories. `.data/snapshots/<name>/` holds one directory copy
 * per snapshot; `.data/snapshots/` itself is never touched by reset because it isn't a LIVE_DIR.
 *
 * Concurrency: a module-level in-flight promise chain (`serialize` below) makes reset/save/restore
 * run one at a time, in call order — never interleaved with each other. An ordinary REQUEST
 * racing the copy window (e.g. a page-view beacon writing `analytics/events.jsonl` mid-`cpSync`)
 * is an accepted dev-tool hazard, not something this module guards against: Snapshots only exists in
 * simulated mode, gated 404 everywhere else, so the worst case is a demo/dev annoyance, never a
 * production concern.
 */

const LIVE_DIRS = ['auth', 'emails', 'analytics', 'pglite', 'storage', 'simulator', 'webhooks', 'sms']
const DEV_SECRET_FILE = 'dev-secret'

function root(): string {
    return dataDir()
}

function liveDirPath(name: string): string {
    return path.join(root(), name)
}

function snapshotsRoot(): string {
    return dataDir('snapshots')
}

function snapshotPath(name: string): string {
    return path.join(snapshotsRoot(), name)
}

function assertValidSnapshotName(name: string): void {
    if (!WORLD_START_NAME_PATTERN.test(name)) throw new ForbiddenError(`invalid snapshot name: ${name}`)
}

/** A saved snapshot may not shadow `'reset'` or a registered demo preset: all three share the namespace a
 *  tour's `snapshot` resolves in (keel/core/presets.ts `resolveWorldStart`), so a collision would make a
 *  tour start from a different world on the server than in the static demo. Checked on SAVE only —
 *  restoring or deleting a snapshot saved before a preset took its name must still work. */
function assertSavableSnapshotName(name: string): void {
    assertValidSnapshotName(name)
    if (isReservedWorldStartName(name, presets)) throw new ForbiddenError(`reserved snapshot name: ${name}`)
}

function devSecretPath(): string {
    return path.join(liveDirPath('auth'), DEV_SECRET_FILE)
}

/**
 * Wipes every LIVE_DIR except the seed people's session-signing secret — read it into memory
 * before the wipe and re-write it after, so sessions signed for seed people survive a reset or
 * restore. A session pointing at a wiped DYNAMIC person (Bob) simply fails to resolve to a user
 * on the next request (→ signin), which is the correct outcome, not a bug to route around.
 */
function wipeLiveDirsPreservingDevSecret(): void {
    const secretFile = devSecretPath()
    const secret = existsSync(secretFile) ? readFileSync(secretFile, 'utf8') : null

    for (const dir of LIVE_DIRS) {
        rmSync(liveDirPath(dir), { force: true, recursive: true })
    }

    if (secret !== null) {
        mkdirSync(liveDirPath('auth'), { recursive: true })
        writeFileAtomicSync(devSecretPath(), secret, { mode: 0o600 })
    }
}

// Serializes reset/save/restore against each other (see module doc comment above). `tail` itself
// is built to never reject (its own rejections are swallowed below), so one failed call never
// poisons the queue for the next caller; the ORIGINAL caller still sees their own rejection via
// `result`, which is a distinct promise from `tail`.
let tail: Promise<void> = Promise.resolve()

function serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = tail.then(fn)
    tail = result.then(
        () => undefined,
        () => undefined,
    )
    return result
}

/** Wipes the simulated world back to the seed baseline: closes pglite first (nothing can touch
 *  `.data/pglite` while it's open), then clears every LIVE_DIR except the dev-secret. */
export async function resetWorld(): Promise<void> {
    return serialize(async () => {
        await closeFakeDb()
        wipeLiveDirsPreservingDevSecret()
    })
}

interface SnapshotMeta {
    at: string
}

function readSnapshotMeta(name: string): SnapshotMeta | null {
    const file = path.join(snapshotPath(name), 'meta.json')
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as SnapshotMeta) : null
}

/** Lists saved snapshots, newest first. Reading the snapshots directory doesn't need to go through the
 *  reset/save/restore queue — it never mutates anything and a snapshot's own directory (once
 *  `saveSnapshot` has finished writing it) is never touched except by a later save of the same name
 *  or a restore's read. */
export function listSnapshots(): { name: string; at: string }[] {
    const dir = snapshotsRoot()
    return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({ name: entry.name, at: readSnapshotMeta(entry.name)?.at ?? '' }))
        .sort((a, b) => (a.at < b.at ? 1 : -1))
}

/** Saves (or overwrites) a named snapshot: closes pglite, then copies every LIVE_DIR that
 *  currently exists into `.data/snapshots/<name>/`, plus a small `meta.json` recording when. */
export async function saveSnapshot(name: string): Promise<void> {
    assertSavableSnapshotName(name)
    return serialize(async () => {
        await closeFakeDb()
        const dest = snapshotPath(name)
        rmSync(dest, { force: true, recursive: true })
        mkdirSync(dest, { recursive: true })
        for (const dir of LIVE_DIRS) {
            const src = liveDirPath(dir)
            if (existsSync(src)) cpSync(src, path.join(dest, dir), { recursive: true })
        }
        const meta: SnapshotMeta = { at: new Date().toISOString() }
        writeJsonAtomicSync(path.join(dest, 'meta.json'), meta)
    })
}

/** Deletes a named snapshot. Runs through the same queue as save/restore so a delete can never
 *  interleave with a restore reading the same directory. */
export async function deleteSnapshot(name: string): Promise<void> {
    assertValidSnapshotName(name)
    return serialize(async () => {
        const dir = snapshotPath(name)
        if (!existsSync(dir)) throw new NotFoundError(`unknown snapshot: ${name}`)
        rmSync(dir, { force: true, recursive: true })
    })
}

/** Restores a named snapshot: validates it exists, closes pglite, wipes LIVE_DIRS (preserving the
 *  dev-secret like reset does), then copies each saved directory back. */
export async function restoreSnapshot(name: string): Promise<void> {
    assertValidSnapshotName(name)
    return serialize(async () => {
        const src = snapshotPath(name)
        if (!existsSync(src)) throw new NotFoundError(`unknown snapshot: ${name}`)

        await closeFakeDb()
        wipeLiveDirsPreservingDevSecret()
        for (const dir of LIVE_DIRS) {
            const dirSrc = path.join(src, dir)
            if (existsSync(dirSrc)) cpSync(dirSrc, liveDirPath(dir), { recursive: true })
        }
    })
}
