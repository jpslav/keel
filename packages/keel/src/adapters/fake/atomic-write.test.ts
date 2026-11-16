import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { makeTestTmpDir } from '../../../../../tests/support/tmp-dir'
import { writeFileAtomic, writeFileAtomicSync, writeJsonAtomic, writeJsonAtomicSync } from './atomic-write'

function freshDir(): string {
    return makeTestTmpDir('atomic-write-')
}

describe('atomic-write', () => {
    test('sync JSON write is byte-identical to the plain JSON.stringify(value, null, 2) format', () => {
        const file = path.join(freshDir(), 'value.json')
        const value = { hello: 'world', n: 1, nested: { ok: true } }
        writeJsonAtomicSync(file, value)
        expect(readFileSync(file, 'utf8')).toBe(JSON.stringify(value, null, 2))
    })

    test('async JSON write is byte-identical to the plain JSON.stringify(value, null, 2) format', async () => {
        const file = path.join(freshDir(), 'value.json')
        const value = { hello: 'world', n: 1, nested: { ok: true } }
        await writeJsonAtomic(file, value)
        expect(readFileSync(file, 'utf8')).toBe(JSON.stringify(value, null, 2))
    })

    test('no temp file survives a successful write', async () => {
        const dir = freshDir()
        const file = path.join(dir, 'value.json')
        writeJsonAtomicSync(file, { a: 1 })
        await writeJsonAtomic(file, { a: 2 })
        // Only the target should remain — the ".<pid>.<uuid>.tmp" siblings must be gone, on both
        // the success path (renamed away) and this test's own cleanup expectations.
        expect(readdirSync(dir)).toEqual(['value.json'])
    })

    test("mode option lands on the published file (rename preserves the temp file's mode)", () => {
        const file = path.join(freshDir(), 'secret')
        writeFileAtomicSync(file, 'shh', { mode: 0o600 })
        expect(statSync(file).mode & 0o777).toBe(0o600)
    })

    test('a write that fails before the rename leaves no temp file behind', () => {
        const dir = freshDir()
        // "missing" doesn't exist, so even the temp file's own write fails (ENOENT on the dir) —
        // proving the cleanup path runs (and swallows its own ENOENT) even when there was nothing
        // to clean up.
        const file = path.join(dir, 'missing', 'value.json')
        expect(() => writeFileAtomicSync(file, 'x')).toThrow()
        expect(readdirSync(dir)).toEqual([])
    })

    test('the async variant cleans up the same way on failure', async () => {
        const dir = freshDir()
        const file = path.join(dir, 'missing', 'value.json')
        await expect(writeFileAtomic(file, 'x')).rejects.toThrow()
        expect(readdirSync(dir)).toEqual([])
    })

    test('the raw (non-JSON) variant round-trips binary payloads, not just strings', async () => {
        const file = path.join(freshDir(), 'blob.bin')
        const bytes = new Uint8Array([1, 2, 3, 4, 250])
        await writeFileAtomic(file, bytes)
        expect(new Uint8Array(readFileSync(file))).toEqual(bytes)
    })

    test('concurrent writers of different lengths never let a reader observe a spliced/partial file', async () => {
        const dir = freshDir()
        const file = path.join(dir, 'racy.json')

        // Payloads of deliberately different lengths (10 bytes up to ~5KB) — this is the shape
        // that corrupts a plain writeFileSync: writer A's truncate-then-write can land in the
        // middle of writer B's, so the file transiently holds a mix of both. Distinct `id`s make
        // every value structurally comparable to "one of the writers won," never a hybrid.
        const values = Array.from({ length: 24 }, (_, i) => ({
            id: i,
            payload: String(i).repeat(10 ** (i % 4)),
        }))

        const observed: unknown[] = []
        let writesInFlight = true

        // Poll the target path as fast as the event loop schedules it (no fixed-duration sleep —
        // just yield with setImmediate) for as long as writes are still in flight, recording every
        // read seen. If any write ever truncated-then-streamed instead of rename-published, one of
        // these reads would land mid-write and JSON.parse below would throw on a torn file.
        async function pollWhileWriting(): Promise<void> {
            while (writesInFlight) {
                if (existsSync(file)) {
                    const raw = readFileSync(file, 'utf8')
                    observed.push(JSON.parse(raw))
                }
                await new Promise<void>((resolve) => setImmediate(resolve))
            }
        }

        const poller = pollWhileWriting()
        await Promise.all(values.map((value) => writeJsonAtomic(file, value)))
        writesInFlight = false
        await poller

        // The file must settle on exactly one writer's value too (last rename wins, never a merge).
        observed.push(JSON.parse(readFileSync(file, 'utf8')))

        expect(observed.length).toBeGreaterThan(0)
        for (const seen of observed) {
            expect(values).toContainEqual(seen)
        }
    })
})
