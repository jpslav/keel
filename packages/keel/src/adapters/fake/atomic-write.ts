import { renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { rename, unlink, writeFile } from 'node:fs/promises'

/**
 * Atomic file writes for the fake adapters (packages/keel/src/adapters/fake/*.ts). Internal helper —
 * NOT part of keel's public surface (packages/keel/package.json `exports`); every fake adapter
 * reaches it by relative import, same as any other module-private file in this directory.
 *
 * WHY this exists: every fake adapter persists its state as a flat file, and under concurrent
 * requests two writers can land on the SAME file at once (see
 * .claude/future-tasks/e2e-shared-world-blocks-parallelism.md). Plain `writeFileSync`/`writeFile`
 * TRUNCATE the file and then stream the new bytes in — so if writer A (shorter payload) and writer
 * B (longer payload) interleave, a reader can observe B's truncate landing after A has already
 * written, leaving A's shorter content followed by the tail of B's longer content: neither writer's
 * value, and not even valid JSON. That splice is exactly what produced
 * `SyntaxError: Unexpected non-whitespace character after JSON at position 751` on an 821-byte
 * invites.json.
 *
 * POSIX `rename()` is atomic WITHIN one filesystem: a concurrent reader of the TARGET path always
 * sees either the whole old file or the whole new file, never a partial one. So every write here
 * goes to a fresh temp file colocated with the target (same directory ⇒ guaranteed same filesystem
 * ⇒ the rename below is actually atomic — renaming across filesystems silently falls back to
 * copy+delete, which reintroduces the exact race this module exists to remove) and is published
 * with a rename.
 *
 * This removes CORRUPTION, not lost updates: two concurrent read-modify-write cycles on the same
 * file can still race each other to "last write wins" (the second rename simply clobbers the
 * first's content with its own). That's a known, separate problem — see the future-task doc's
 * "world per worker" follow-up fix.
 */

interface WriteAtomicOptions {
    /** chmod applied to the temp file before it's published. Rename preserves the SOURCE file's
     *  mode (the temp file's), so setting it here — rather than on the target after the fact — is
     *  what makes a call site's `{ mode: 0o600 }` survive the swap atomically; a separate post-
     *  rename chmod would itself be a window where the file briefly has the wrong permissions. */
    mode?: number
}

/**
 * Temp path colocated with `file` — same directory, so same filesystem, so the rename below is
 * actually atomic (see module doc). Suffixed with this process's pid AND a random UUID so two
 * concurrent writers — even two requests handled by the same process — never share a temp path:
 * sharing one would just move the truncate/write race from the target file onto the temp file.
 */
function tempFileFor(file: string): string {
    return `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
}

/** True for the expected cleanup outcome (rename already moved the temp file away, or it was never
 *  created because the write itself failed first). Anything else is a real problem — e.g. a
 *  permissions error — and must not be swallowed alongside it. */
function isEnoent(err: unknown): boolean {
    return err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT'
}

/** Removes a leftover temp file after a failed write/rename, swallowing the expected ENOENT (the
 *  write itself never got far enough to create it) but surfacing anything else. Not called on the
 *  success path: a successful rename has already made `tmp` not exist, so there's nothing to do. */
function cleanupTempSync(tmp: string): void {
    try {
        unlinkSync(tmp)
    } catch (err) {
        if (!isEnoent(err)) throw err
    }
}

/** Async twin of cleanupTempSync. */
async function cleanupTemp(tmp: string): Promise<void> {
    try {
        await unlink(tmp)
    } catch (err) {
        if (!isEnoent(err)) throw err
    }
}

/**
 * Synchronous atomic write of raw bytes/text. Reserved for the call sites that are themselves
 * synchronous (session/dev-secret provisioning, guarded by `existsSync` in the same sync function)
 * and can't become async without rippling into their callers.
 */
export function writeFileAtomicSync(file: string, data: string | Uint8Array, opts?: WriteAtomicOptions): void {
    const tmp = tempFileFor(file)
    try {
        writeFileSync(tmp, data, opts?.mode !== undefined ? { mode: opts.mode } : undefined)
        renameSync(tmp, file)
    } catch (err) {
        cleanupTempSync(tmp)
        throw err
    }
}

/** Async atomic write of raw bytes/text — the default for the fake adapters' async ports (email,
 *  sms, storage, webhooks-as-async-callers, etc). See writeFileAtomicSync for the sync twin. */
export async function writeFileAtomic(
    file: string,
    data: string | Uint8Array,
    opts?: WriteAtomicOptions,
): Promise<void> {
    const tmp = tempFileFor(file)
    try {
        await writeFile(tmp, data, opts?.mode !== undefined ? { mode: opts.mode } : undefined)
        await rename(tmp, file)
    } catch (err) {
        await cleanupTemp(tmp)
        throw err
    }
}

/** Synchronous atomic JSON write. `JSON.stringify(value, null, 2)` matches every existing
 *  fake-adapter JSON call site's formatting exactly, so swapping this in is byte-identical for a
 *  single writer. */
export function writeJsonAtomicSync(file: string, value: unknown, opts?: WriteAtomicOptions): void {
    writeFileAtomicSync(file, JSON.stringify(value, null, 2), opts)
}

/** Async atomic JSON write — see writeJsonAtomicSync. */
export async function writeJsonAtomic(file: string, value: unknown, opts?: WriteAtomicOptions): Promise<void> {
    await writeFileAtomic(file, JSON.stringify(value, null, 2), opts)
}
