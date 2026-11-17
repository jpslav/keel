import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeTestTmpDir } from '../../../../../tests/support/tmp-dir'
import { NotFoundError, PreconditionFailedError } from '../../ports/errors'

// Point all fake-adapter state at a throwaway dir BEFORE importing the adapters.
const tmp = makeTestTmpDir('app-fakes-')
beforeAll(() => {
    process.env.APP_DATA_DIR = tmp
})
afterAll(() => {
    delete process.env.APP_DATA_DIR
})

describe('fake storage', () => {
    test('put/get round-trip preserves body and content type', async () => {
        const { fakeStorage } = await import('./storage')
        await fakeStorage.put('reports/hello.txt', 'hello world', 'text/plain')
        const object = await fakeStorage.get('reports/hello.txt')
        expect(object).not.toBeNull()
        expect(new TextDecoder().decode(object!.body)).toBe('hello world')
        expect(object!.contentType).toBe('text/plain')
    })

    test('missing keys return null; escape attempts are rejected', async () => {
        const { fakeStorage } = await import('./storage')
        expect(await fakeStorage.get('nope/missing.bin')).toBeNull()
        await expect(fakeStorage.put('../outside.txt', 'x', 'text/plain')).rejects.toThrow(/invalid storage key/)
    })

    describe('list and delete', () => {
        // A directory of its own so earlier tests' objects (and the upload secret they provoked) never
        // leak into an exact-equality assertion.
        const sub = (name: string) => `list-delete/${name}`

        test('list returns sorted FULL keys, with bookkeeping files never among them', async () => {
            const { fakeStorage } = await import('./storage')
            // Mint a target first so the upload secret exists at the store root.
            await fakeStorage.createUploadTarget(sub('x'), { contentType: 'text/plain', maxBytes: 1 })
            await fakeStorage.put(sub('sorted/b.txt'), 'b', 'text/plain')
            await fakeStorage.put(sub('sorted/a.txt'), 'a', 'text/plain')
            await fakeStorage.put(sub('sorted/deep/c.txt'), 'c', 'text/plain')

            expect(await fakeStorage.list(sub('sorted/'))).toEqual([
                sub('sorted/a.txt'),
                sub('sorted/b.txt'),
                sub('sorted/deep/c.txt'),
            ])
            // Everything: still no `.meta.json` sidecar and no `upload-secret`.
            const all = await fakeStorage.list('')
            expect(all).toContain(sub('sorted/a.txt'))
            expect(all.filter((key) => key.endsWith('.meta.json') || key === 'upload-secret')).toEqual([])
            expect([...all].sort()).toEqual(all)
        })

        test('the prefix is a literal string prefix, not a directory boundary', async () => {
            const { fakeStorage } = await import('./storage')
            await fakeStorage.put(sub('lit/a/b'), '1', 'text/plain')
            await fakeStorage.put(sub('lit/a/bc'), '2', 'text/plain')
            await fakeStorage.put(sub('lit/a/c'), '3', 'text/plain')
            expect(await fakeStorage.list(sub('lit/a/b'))).toEqual([sub('lit/a/b'), sub('lit/a/bc')])
            expect(await fakeStorage.list(sub('lit/a/b/'))).toEqual([])
            expect(await fakeStorage.list(sub('lit/nothing-here'))).toEqual([])
        })

        test('keys that collide with the fake bookkeeping are refused, not silently shadowed', async () => {
            const { fakeStorage } = await import('./storage')
            await expect(fakeStorage.put('thing.meta.json', 'x', 'text/plain')).rejects.toThrow(/reserved/)
            await expect(fakeStorage.put('upload-secret', 'x', 'text/plain')).rejects.toThrow(/reserved/)
            // ...and are never objects: not readable (a GET route maps null to 404, not a throw to 500),
            // and a delete naming one is a no-op that leaves the real object's sidecar in place.
            await fakeStorage.put(sub('kept'), 'k', 'text/plain')
            expect(await fakeStorage.get(`${sub('kept')}.meta.json`)).toBeNull()
            expect(await fakeStorage.get('upload-secret')).toBeNull()
            await fakeStorage.delete([`${sub('kept')}.meta.json`, 'upload-secret'])
            expect(await fakeStorage.get(sub('kept'))).toEqual({
                body: new TextEncoder().encode('k'),
                contentType: 'text/plain',
            })
        })

        test('delete removes the object and its sidecar, and is idempotent', async () => {
            const { fakeStorage } = await import('./storage')
            await fakeStorage.put(sub('del/one'), '1', 'text/plain')
            await fakeStorage.put(sub('del/two'), '2', 'text/plain')
            await fakeStorage.put(sub('del/keep'), '3', 'text/plain')

            await fakeStorage.delete([sub('del/one'), sub('del/two'), sub('del/never-existed')])

            expect(await fakeStorage.get(sub('del/one'))).toBeNull()
            expect(await fakeStorage.list(sub('del/'))).toEqual([sub('del/keep')])
            // The sidecar went with it: a re-put of the same key must not inherit stale metadata.
            await fakeStorage.put(sub('del/one'), 'again', 'application/json')
            expect((await fakeStorage.get(sub('del/one')))!.contentType).toBe('application/json')
            // Deleting what is already gone is not an error.
            await expect(fakeStorage.delete([sub('del/never-existed')])).resolves.toBeUndefined()
            await expect(fakeStorage.delete([])).resolves.toBeUndefined()
        })

        test('delete keeps resolveKey’s path-escape guard', async () => {
            const { fakeStorage } = await import('./storage')
            await expect(fakeStorage.delete(['../outside.txt'])).rejects.toThrow(/invalid storage key/)
        })
    })

    describe('copy', () => {
        // A directory of its own, as for list and delete.
        const sub = (name: string) => `copy-test/${name}`
        const text = (body: Uint8Array) => new TextDecoder().decode(body)

        test('copies the bytes and the content type, and leaves the source where it was', async () => {
            const { fakeStorage } = await import('./storage')
            // Not text: a copy that went through a string would corrupt these.
            const bytes = new Uint8Array([0, 255, 128, 10, 13, 0, 1, 254])
            await fakeStorage.put(sub('basic/from.bin'), bytes, 'application/x-keel-test')

            await expect(fakeStorage.copy(sub('basic/from.bin'), sub('basic/deep/to.bin'))).resolves.toBeUndefined()

            expect(await fakeStorage.get(sub('basic/deep/to.bin'))).toEqual({
                body: bytes,
                contentType: 'application/x-keel-test',
            })
            expect((await fakeStorage.get(sub('basic/from.bin')))!.body).toEqual(bytes)
            expect(await fakeStorage.list(sub('basic/'))).toEqual([sub('basic/deep/to.bin'), sub('basic/from.bin')])
        })

        test('the copy is its own object: changing the source later does not change it', async () => {
            const { fakeStorage } = await import('./storage')
            await fakeStorage.put(sub('own/from'), 'one', 'text/plain')
            await fakeStorage.copy(sub('own/from'), sub('own/to'))

            await fakeStorage.put(sub('own/from'), 'two', 'application/json')

            expect(await fakeStorage.get(sub('own/to'))).toEqual({
                body: new TextEncoder().encode('one'),
                contentType: 'text/plain',
            })
        })

        test('overwrites an existing destination, body and content type both, as put does', async () => {
            const { fakeStorage } = await import('./storage')
            await fakeStorage.put(sub('over/from'), 'new bytes', 'text/plain')
            await fakeStorage.put(sub('over/to'), 'old bytes that were longer', 'application/json')

            await fakeStorage.copy(sub('over/from'), sub('over/to'))

            const object = (await fakeStorage.get(sub('over/to')))!
            expect(text(object.body)).toBe('new bytes')
            expect(object.contentType).toBe('text/plain')
            expect(await fakeStorage.list(sub('over/'))).toEqual([sub('over/from'), sub('over/to')])
        })

        test('a missing source is a NotFoundError and creates nothing', async () => {
            const { fakeStorage } = await import('./storage')

            const failure = fakeStorage.copy(sub('missing/nope'), sub('missing/deep/dest'))

            await expect(failure).rejects.toBeInstanceOf(NotFoundError)
            await expect(failure).rejects.toThrow(/missing\/nope/)
            expect(await fakeStorage.get(sub('missing/deep/dest'))).toBeNull()
            expect(await fakeStorage.list(sub('missing/'))).toEqual([])
            // Nothing at all: not even the destination's directory, which the check runs before.
            expect(existsSync(path.join(tmp, 'storage', sub('missing/deep')))).toBe(false)
        })

        test('a source that is a directory is a missing source too: a directory is not an object', async () => {
            const { fakeStorage } = await import('./storage')
            await fakeStorage.put(sub('dir/inner/x'), 'x', 'text/plain')

            const failure = fakeStorage.copy(sub('dir/inner'), sub('dir/deep/dest'))

            await expect(failure).rejects.toBeInstanceOf(NotFoundError)
            expect(existsSync(path.join(tmp, 'storage', sub('dir/deep')))).toBe(false)
            expect(await fakeStorage.list(sub('dir/'))).toEqual([sub('dir/inner/x')])
        })

        test('a source deleted while it is being copied is a missing source, and leaves nothing behind', async () => {
            const { fakeStorage } = await import('./storage')
            let missing = 0
            // The two race for real (an in-process interleaving, not a mock), so each round may go either way; what
            // may never happen is a raw filesystem error, an orphan sidecar or a temp file. It runs until the
            // deletion has won a few times, so the failure path is known to have run, and gives up at 300 rounds.
            for (let round = 0; round < 300 && missing < 3; round++) {
                const from = sub(`gone/${round}/from`)
                const to = sub(`gone/${round}/to`)
                await fakeStorage.put(from, 'bytes', 'text/plain')

                const [copied, deleted] = await Promise.allSettled([
                    fakeStorage.copy(from, to),
                    fakeStorage.delete([from]),
                ])

                expect(deleted.status).toBe('fulfilled')
                const dir = path.join(tmp, 'storage', sub(`gone/${round}`))
                expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([])
                if (copied.status === 'rejected') {
                    missing++
                    expect(copied.reason).toBeInstanceOf(NotFoundError)
                    expect(readdirSync(dir)).not.toContain('to.meta.json')
                    expect(await fakeStorage.get(to)).toBeNull()
                } else {
                    expect(text((await fakeStorage.get(to))!.body)).toBe('bytes')
                }
            }
            // Not vacuous: the failure path ran.
            expect(missing).toBeGreaterThan(0)
        })

        test('a destination that cannot be published fails and leaves no temp file, whichever file blocks it', async () => {
            const { fakeStorage } = await import('./storage')
            await fakeStorage.put(sub('pubfail/from'), 'f', 'text/plain')
            // The fake cannot hold an object `d` beside the directory `d/` (`put` fails on such a key too), and
            // the sidecar of `e` is `e.meta.json`, which a key like `e.meta.json/inner` makes a directory.
            await fakeStorage.put(sub('pubfail/d/inner'), 'i', 'text/plain')
            await fakeStorage.put(sub('pubfail/e.meta.json/inner'), 'i', 'text/plain')

            // the body cannot be published (the sidecar already was)
            await expect(fakeStorage.copy(sub('pubfail/from'), sub('pubfail/d'))).rejects.toThrow()
            // the sidecar cannot be published (the body, staged beside it, must not be left behind)
            await expect(fakeStorage.copy(sub('pubfail/from'), sub('pubfail/e'))).rejects.toThrow()

            const dir = path.join(tmp, 'storage', sub('pubfail'))
            expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([])
            expect(await fakeStorage.list(sub('pubfail/'))).toEqual([
                sub('pubfail/d/inner'),
                sub('pubfail/e.meta.json/inner'),
                sub('pubfail/from'),
            ])
            expect((await fakeStorage.get(sub('pubfail/from')))!.contentType).toBe('text/plain')
        })

        test('a source that is a bookkeeping name is a missing source, and the bookkeeping is untouched', async () => {
            const { fakeStorage } = await import('./storage')
            await fakeStorage.put(sub('book/kept'), 'k', 'text/plain')

            await expect(fakeStorage.copy(`${sub('book/kept')}.meta.json`, sub('book/dest'))).rejects.toBeInstanceOf(
                NotFoundError,
            )
            await expect(fakeStorage.copy('upload-secret', sub('book/dest2'))).rejects.toBeInstanceOf(NotFoundError)
            expect(await fakeStorage.list(sub('book/'))).toEqual([sub('book/kept')])
        })

        test('a destination that is a bookkeeping name is refused, as put refuses it', async () => {
            const { fakeStorage } = await import('./storage')
            await fakeStorage.put(sub('res/from'), 'f', 'text/plain')

            await expect(fakeStorage.copy(sub('res/from'), sub('res/x.meta.json'))).rejects.toThrow(/reserved/)
            await expect(fakeStorage.copy(sub('res/from'), 'upload-secret')).rejects.toThrow(/reserved/)
            expect(await fakeStorage.list(sub('res/'))).toEqual([sub('res/from')])
        })

        test('cannot reach outside the store through either key', async () => {
            const { fakeStorage } = await import('./storage')
            await fakeStorage.put(sub('esc/from'), 'f', 'text/plain')

            await expect(fakeStorage.copy('../outside.txt', sub('esc/a'))).rejects.toThrow(/invalid storage key/)
            await expect(fakeStorage.copy(sub('esc/from'), '../outside.txt')).rejects.toThrow(/invalid storage key/)
            await expect(fakeStorage.copy(sub('esc/from'), '../../outside.txt')).rejects.toThrow(/invalid storage key/)
            // Neither refusal wrote anywhere: not outside the store, not inside it.
            expect(existsSync(path.join(tmp, 'outside.txt'))).toBe(false)
            expect(existsSync(path.join(tmp, '..', 'outside.txt'))).toBe(false)
            expect(await fakeStorage.list(sub('esc/'))).toEqual([sub('esc/from')])
        })

        test('a destination is never visible half-copied, while a large copy is in flight', async () => {
            const { fakeStorage } = await import('./storage')
            // Big enough that copying it takes many polls on a real disk (a plain copyFile into the
            // destination shows thousands of distinct partial sizes for 100 MB on the development machine).
            const size = 64 * 1024 * 1024
            await fakeStorage.put(sub('big/from'), new Uint8Array(size).fill(7), 'application/x-keel-big')
            const body = path.join(tmp, 'storage', sub('big/to'))
            const sidecar = `${body}.meta.json`

            let finished = false
            const copying = fakeStorage.copy(sub('big/from'), sub('big/to')).finally(() => (finished = true))
            const bodySizes = new Set<number | 'absent'>()
            let bodyWithoutSidecar = 0
            while (!finished) {
                // Body first: if it is there, its sidecar (published before it, and never removed) must be too.
                const bodyNow = existsSync(body) ? statSync(body).size : 'absent'
                bodySizes.add(bodyNow)
                if (bodyNow !== 'absent' && !existsSync(sidecar)) bodyWithoutSidecar++
                await new Promise((resolve) => setImmediate(resolve))
            }
            await copying

            // Only ever not there, or whole. (A poll can miss the instant of the rename; it cannot see a partial.)
            expect([...bodySizes].filter((seen) => seen !== 'absent' && seen !== size)).toEqual([])
            expect(bodyWithoutSidecar).toBe(0)
            expect(statSync(body).size).toBe(size)
            expect((await fakeStorage.get(sub('big/to')))!.contentType).toBe('application/x-keel-big')
        })

        test('copying an object onto itself is refused, including by another spelling of the same key', async () => {
            const { fakeStorage } = await import('./storage')
            await fakeStorage.put(sub('same/k'), 'kept', 'text/plain')

            await expect(fakeStorage.copy(sub('same/k'), sub('same/k'))).rejects.toThrow(/same key/)
            await expect(fakeStorage.copy(sub('same/k'), sub('same/x/../k'))).rejects.toThrow(/same key/)

            expect(text((await fakeStorage.get(sub('same/k')))!.body)).toBe('kept')
            // The same refusal for a key that does not exist, as the real adapter gives without asking S3.
            const missing = fakeStorage.copy(sub('same/never'), sub('same/never'))
            await expect(missing).rejects.toThrow(/same key/)
            await expect(missing).rejects.not.toBeInstanceOf(NotFoundError)
        })
    })

    describe('head', () => {
        const sub = (name: string) => `head-test/${name}`

        test('reports size, content type, etag and last-modified, without the bytes', async () => {
            const { fakeStorage } = await import('./storage')
            const bytes = new Uint8Array([0, 255, 128, 10, 13, 0, 1, 254, 7])
            const before = Date.now() - 1000
            await fakeStorage.put(sub('basic'), bytes, 'application/x-keel-test')

            const info = (await fakeStorage.head(sub('basic')))!

            expect(info.size).toBe(bytes.length)
            expect(info.contentType).toBe('application/x-keel-test')
            expect(info.etag).toMatch(/^"[0-9a-f]{64}"$/)
            expect(info.lastModified).toBeInstanceOf(Date)
            expect(info.lastModified.getTime()).toBeGreaterThanOrEqual(before)
            expect(info.lastModified.getTime()).toBeLessThanOrEqual(Date.now() + 1000)
            // and it is the same object get returns
            expect((await fakeStorage.get(sub('basic')))!.body.length).toBe(info.size)
        })

        test('a size of zero is a size of zero', async () => {
            const { fakeStorage } = await import('./storage')
            await fakeStorage.put(sub('empty'), '', 'text/plain')
            expect(await fakeStorage.head(sub('empty'))).toMatchObject({ size: 0, contentType: 'text/plain' })
        })

        test('is null for a missing key, a directory and a bookkeeping name, as get is', async () => {
            const { fakeStorage } = await import('./storage')
            await fakeStorage.put(sub('dir/inner'), 'i', 'text/plain')
            // Even with a sidecar sitting beside it, so nothing but "it is not a regular file" can say no.
            writeFileSync(path.join(tmp, 'storage', `${sub('dir')}.meta.json`), JSON.stringify({ contentType: 'x/y' }))

            expect(await fakeStorage.head(sub('nope'))).toBeNull()
            expect(await fakeStorage.head(sub('dir'))).toBeNull() // a directory is not an object
            expect(await fakeStorage.head(`${sub('dir/inner')}.meta.json`)).toBeNull()
            expect(await fakeStorage.head('upload-secret')).toBeNull()
        })

        test('refuses a path escape, as get does', async () => {
            const { fakeStorage } = await import('./storage')
            await expect(fakeStorage.head('../outside.txt')).rejects.toThrow(/invalid storage key/)
        })

        test('a body with no sidecar, or a sidecar that is not JSON, is corruption and throws, as get does: it is not "missing"', async () => {
            const { fakeStorage } = await import('./storage')
            const store = path.join(tmp, 'storage')
            mkdirSync(path.join(store, sub('corrupt')), { recursive: true })
            writeFileSync(path.join(store, sub('corrupt/no-sidecar')), 'bytes')
            await fakeStorage.put(sub('corrupt/bad-json'), 'bytes', 'text/plain')
            writeFileSync(path.join(store, `${sub('corrupt/bad-json')}.meta.json`), 'this is not json')

            await expect(fakeStorage.head(sub('corrupt/no-sidecar'))).rejects.toThrow(/ENOENT/)
            await expect(fakeStorage.head(sub('corrupt/bad-json'))).rejects.toThrow(SyntaxError)
            // and `get` says the same of both, so the two reads agree about what is broken
            await expect(fakeStorage.get(sub('corrupt/no-sidecar'))).rejects.toThrow(/ENOENT/)
            await expect(fakeStorage.get(sub('corrupt/bad-json'))).rejects.toThrow(SyntaxError)
        })

        test('the etag follows the bytes: same bytes, same etag; other bytes, another; a rewrite changes it', async () => {
            const { fakeStorage } = await import('./storage')
            await fakeStorage.put(sub('etag/a'), 'same bytes', 'text/plain')
            await fakeStorage.put(sub('etag/b'), 'same bytes', 'application/json')
            await fakeStorage.put(sub('etag/c'), 'other bytes', 'text/plain')

            const [a, b, c] = await Promise.all(['a', 'b', 'c'].map((name) => fakeStorage.head(sub(`etag/${name}`))))
            expect(b!.etag).toBe(a!.etag) // the content type is not part of it
            expect(c!.etag).not.toBe(a!.etag)

            await fakeStorage.put(sub('etag/a'), 'rewritten', 'text/plain')
            expect((await fakeStorage.head(sub('etag/a')))!.etag).not.toBe(a!.etag)
        })

        test('last-modified moves on a rewrite, and a copy is a new object with its own time', async () => {
            const { fakeStorage } = await import('./storage')
            await fakeStorage.put(sub('time/from'), 'one', 'text/plain')
            const first = (await fakeStorage.head(sub('time/from')))!.lastModified.getTime()
            await new Promise((resolve) => setTimeout(resolve, 30))

            await fakeStorage.copy(sub('time/from'), sub('time/to'))
            const copied = (await fakeStorage.head(sub('time/to')))!
            expect(copied.lastModified.getTime()).toBeGreaterThan(first)

            await new Promise((resolve) => setTimeout(resolve, 30))
            await fakeStorage.put(sub('time/from'), 'two', 'text/plain')
            expect((await fakeStorage.head(sub('time/from')))!.lastModified.getTime()).toBeGreaterThan(
                copied.lastModified.getTime(),
            )
        })

        test('in the fake a copy has its source’s etag (the port does not promise that across keys)', async () => {
            const { fakeStorage } = await import('./storage')
            await fakeStorage.put(sub('same/from'), 'bytes', 'text/plain')
            await fakeStorage.copy(sub('same/from'), sub('same/to'))
            expect((await fakeStorage.head(sub('same/to')))!.etag).toBe(
                (await fakeStorage.head(sub('same/from')))!.etag,
            )
        })
    })

    describe('copy with ifMatch', () => {
        const sub = (name: string) => `copy-if-match/${name}`
        const text = (body: Uint8Array) => new TextDecoder().decode(body)

        test('copies when the source is still the version the etag names, as finalize does (head, then copy)', async () => {
            const { fakeStorage } = await import('./storage')
            await fakeStorage.put(sub('ok/staged'), 'validated bytes', 'application/pdf')
            const info = (await fakeStorage.head(sub('ok/staged')))!

            await fakeStorage.copy(sub('ok/staged'), sub('ok/final'), { ifMatch: info.etag })

            expect(await fakeStorage.get(sub('ok/final'))).toEqual({
                body: new TextEncoder().encode('validated bytes'),
                contentType: 'application/pdf',
            })
        })

        test('copies nothing, and says so, when the source changed after the head', async () => {
            const { fakeStorage } = await import('./storage')
            await fakeStorage.put(sub('stale/staged'), 'what was checked', 'application/pdf')
            const checked = (await fakeStorage.head(sub('stale/staged')))!
            await fakeStorage.put(sub('stale/staged'), 'swapped after the check', 'application/pdf')

            const failure = fakeStorage.copy(sub('stale/staged'), sub('stale/deep/final'), { ifMatch: checked.etag })

            await expect(failure).rejects.toBeInstanceOf(PreconditionFailedError)
            await expect(failure).rejects.toThrow(/no longer the version .*nothing was copied/)
            expect(await fakeStorage.get(sub('stale/deep/final'))).toBeNull()
            expect(existsSync(path.join(tmp, 'storage', sub('stale/deep')))).toBe(true) // the directory is made before staging
            expect(readdirSync(path.join(tmp, 'storage', sub('stale/deep')))).toEqual([]) // and nothing, not even a temp file, is in it
            expect(text((await fakeStorage.get(sub('stale/staged')))!.body)).toBe('swapped after the check')
        })

        test('leaves an existing destination exactly as it was when the precondition fails', async () => {
            const { fakeStorage } = await import('./storage')
            await fakeStorage.put(sub('keep/staged'), 'new', 'text/plain')
            await fakeStorage.put(sub('keep/final'), 'previous', 'application/json')

            await expect(
                fakeStorage.copy(sub('keep/staged'), sub('keep/final'), { ifMatch: '"not-its-etag"' }),
            ).rejects.toBeInstanceOf(PreconditionFailedError)

            expect(await fakeStorage.get(sub('keep/final'))).toEqual({
                body: new TextEncoder().encode('previous'),
                contentType: 'application/json',
            })
        })

        test('the etag must come back unchanged: it is opaque, so a stripped or reformatted one does not match', async () => {
            const { fakeStorage } = await import('./storage')
            await fakeStorage.put(sub('opaque/staged'), 'bytes', 'text/plain')
            const { etag } = (await fakeStorage.head(sub('opaque/staged')))!

            await expect(
                fakeStorage.copy(sub('opaque/staged'), sub('opaque/a'), { ifMatch: etag.replaceAll('"', '') }),
            ).rejects.toBeInstanceOf(PreconditionFailedError)
            await expect(
                fakeStorage.copy(sub('opaque/staged'), sub('opaque/b'), { ifMatch: etag }),
            ).resolves.toBeUndefined()
        })

        test.each(['', ' ', '*', ' * '])(
            'an ifMatch of %j is refused first of all, and copies nothing',
            async (ifMatch) => {
                const { fakeStorage } = await import('./storage')
                await fakeStorage.put(sub('blank/from'), 'x', 'text/plain')

                await expect(fakeStorage.copy(sub('blank/from'), sub('blank/to'), { ifMatch })).rejects.toThrow(
                    /not empty and not "\*"/,
                )
                // before the other checks too: a missing source or the same key would otherwise be reported first
                await expect(fakeStorage.copy(sub('blank/gone'), sub('blank/to'), { ifMatch })).rejects.toThrow(
                    /not empty/,
                )
                await expect(fakeStorage.copy(sub('blank/from'), sub('blank/from'), { ifMatch })).rejects.toThrow(
                    /not empty/,
                )
                expect(await fakeStorage.get(sub('blank/to'))).toBeNull()
            },
        )

        test('the order of the checks: same key, then a missing source, then the precondition', async () => {
            const { fakeStorage } = await import('./storage')
            await fakeStorage.put(sub('order/k'), 'x', 'text/plain')

            await expect(fakeStorage.copy(sub('order/k'), sub('order/k'), { ifMatch: '"wrong"' })).rejects.toThrow(
                /same key/,
            )
            await expect(
                fakeStorage.copy(sub('order/gone'), sub('order/to'), { ifMatch: '"wrong"' }),
            ).rejects.toBeInstanceOf(NotFoundError)
            await expect(
                fakeStorage.copy(sub('order/k'), sub('order/to'), { ifMatch: '"wrong"' }),
            ).rejects.toBeInstanceOf(PreconditionFailedError)
        })

        test('what lands is exactly the version that matched, even when the source goes A, then B, then A again mid-copy', async () => {
            const { fakeStorage } = await import('./storage')
            let lost = 0
            // A real in-process race. The source is A ("old bytes") with a known etag; a writer makes it B and then A
            // again while a conditional copy runs. Either the copy won (the destination holds A) or it was refused (the
            // destination does not exist); it must never hold B, whose bytes the etag does not name. WHAT THIS DOES NOT
            // PIN: that the hash is of the STAGED copy and not of the source after staging. Those differ only when B is
            // staged and A is back before the check, a window this race did not hit in 5 runs at 3 body sizes; the staged
            // hash is the strict form by construction (docs/build-notes.md, "The ETag is checked on the bytes about to be
            // published"), not by this test.
            for (let round = 0; round < 1000 && lost < 3; round++) {
                const from = sub(`race/${round}/from`)
                const to = sub(`race/${round}/to`)
                await fakeStorage.put(from, 'old bytes', 'text/plain')
                const { etag } = (await fakeStorage.head(from))!

                const [result] = await Promise.allSettled([
                    fakeStorage.copy(from, to, { ifMatch: etag }),
                    (async () => {
                        await fakeStorage.put(from, 'new bytes', 'text/plain')
                        await fakeStorage.put(from, 'old bytes', 'text/plain')
                    })(),
                ])

                if (result.status === 'rejected') {
                    lost++
                    expect(result.reason).toBeInstanceOf(PreconditionFailedError)
                    expect(await fakeStorage.get(to)).toBeNull()
                } else {
                    expect(text((await fakeStorage.get(to))!.body)).toBe('old bytes')
                }
            }
            // Not vacuous: the writer did land in the middle of a copy, and the precondition refused it. (That the copy
            // succeeds when nothing changed is the test above; here only the invariant is raced.)
            expect(lost).toBeGreaterThan(0)
        })
    })

    test('signed url points at the local storage route', async () => {
        const { fakeStorage } = await import('./storage')
        expect(await fakeStorage.getSignedDownloadUrl('reports/hello.txt')).toBe('/api/storage/reports/hello.txt')
    })

    test('createUploadTarget mints the local endpoint + signed fields that verify round-trip', async () => {
        const { fakeStorage, verifyUploadFields } = await import('./storage')
        const target = await fakeStorage.createUploadTarget('uploads/t/u/report.csv', {
            contentType: 'text/csv',
            maxBytes: 1000,
        })
        expect(target.url).toBe('/api/storage-upload')
        expect(target.fields.key).toBe('uploads/t/u/report.csv')
        expect(target.fields['content-type']).toBe('text/csv')
        expect(target.fields['max-bytes']).toBe('1000')

        // The endpoint's verification accepts the untouched fields and returns the parsed constraints.
        expect(verifyUploadFields(target.fields)).toEqual({
            key: 'uploads/t/u/report.csv',
            contentType: 'text/csv',
            maxBytes: 1000,
        })
    })

    test('verifyUploadFields rejects tampering and missing fields', async () => {
        const { fakeStorage, verifyUploadFields } = await import('./storage')
        const target = await fakeStorage.createUploadTarget('uploads/t/u/a.bin', {
            contentType: 'application/octet-stream',
            maxBytes: 500,
        })
        // A re-pointed key, a raised ceiling, a swapped type, or an extended life all invalidate
        // the signature.
        expect(verifyUploadFields({ ...target.fields, key: 'uploads/t/u/evil.bin' })).toBeNull()
        expect(verifyUploadFields({ ...target.fields, 'max-bytes': '999999' })).toBeNull()
        expect(verifyUploadFields({ ...target.fields, 'content-type': 'text/html' })).toBeNull()
        expect(verifyUploadFields({ ...target.fields, signature: 'not-a-signature' })).toBeNull()
        expect(verifyUploadFields({ ...target.fields, expires: String(2 ** 31) })).toBeNull()
        expect(verifyUploadFields({ key: 'x', 'content-type': 'text/plain', 'max-bytes': '1' })).toBeNull()
    })

    test('upload targets expire — a stale target is rejected like a bad signature', async () => {
        vi.useFakeTimers()
        try {
            const { fakeStorage, verifyUploadFields } = await import('./storage')
            const target = await fakeStorage.createUploadTarget('uploads/t/u/late.bin', {
                contentType: 'application/octet-stream',
                maxBytes: 500,
            })
            expect(verifyUploadFields(target.fields)).not.toBeNull()
            // 900s is the ceiling a real S3 presigned POST gets — one second past it, the same
            // untampered fields are dead, so a minted target is not a forever-capability to swap
            // an uploaded object's bytes after confirm.
            vi.advanceTimersByTime(901_000)
            expect(verifyUploadFields(target.fields)).toBeNull()
        } finally {
            vi.useRealTimers()
        }
    })
})

describe('fake email', () => {
    test('send lands in the catch store, newest first', async () => {
        const { fakeEmail, listCaughtEmails } = await import('./email')
        await fakeEmail.send({ to: 'a@example.test', subject: 'first', html: '<p>hi</p>', text: 'hi' })
        await fakeEmail.send({ to: 'b@example.test', subject: 'second', html: '<p>yo</p>', text: 'yo' })
        const emails = listCaughtEmails()
        expect(emails.length).toBeGreaterThanOrEqual(2)
        expect(emails[0]!.subject).toBe('second')
        expect(emails.map((e) => e.to)).toContain('a@example.test')
    })
})

describe('fake analytics', () => {
    test('capture appends to the event log, newest first, with flags defaulting off', async () => {
        const { fakeAnalytics, listCapturedEvents, setFlag } = await import('./analytics')
        await fakeAnalytics.capture('org_invite_sent', { tenant: 'harbor', role: 'member' })
        await fakeAnalytics.capture('assistant_asked', { tenant: 'harbor' })
        const events = listCapturedEvents()
        expect(events.length).toBeGreaterThanOrEqual(2)
        expect(events[0]!.event).toBe('assistant_asked')
        expect(events[0]!.properties).toEqual({ tenant: 'harbor' })
        expect(events.map((e) => e.event)).toContain('org_invite_sent')

        expect(await fakeAnalytics.isFlagEnabled('demo-banner')).toBe(false)

        setFlag('demo-banner', true)
        expect(await fakeAnalytics.isFlagEnabled('demo-banner')).toBe(true)
    })
})

describe('fake llm', () => {
    test('replays the purpose default deterministically', async () => {
        const { fakeLlm } = await import('./llm')
        const request = {
            purpose: 'fixture-echo',
            messages: [{ role: 'user' as const, content: 'Anything at all' }],
        }
        const first = await fakeLlm.complete(request)
        const second = await fakeLlm.complete(request)
        expect(first.text).toBe(second.text)
        expect(first.text).toContain('deterministic')
    })

    test('streaming chunks re-assemble to the complete response', async () => {
        const { fakeLlm } = await import('./llm')
        const request = { purpose: 'fixture-echo', messages: [{ role: 'user' as const, content: 'q' }] }
        let streamed = ''
        for await (const chunk of fakeLlm.stream(request)) streamed += chunk
        expect(streamed).toBe((await fakeLlm.complete(request)).text)
    })

    test('unknown purposes fail loudly with recording instructions', async () => {
        const { fakeLlm } = await import('./llm')
        await expect(fakeLlm.complete({ purpose: 'never-recorded', messages: [] })).rejects.toThrow(/llm:record/)
    })
})

describe('fake llm request catch', () => {
    const user = (content: string) => ({ role: 'user' as const, content })

    beforeEach(async () => {
        const { clearCaughtLlmRequests } = await import('./llm')
        clearCaughtLlmRequests()
    })

    test('complete catches purpose, system and messages', async () => {
        const { fakeLlm, listCaughtLlmRequests } = await import('./llm')
        await fakeLlm.complete({ purpose: 'fixture-echo', system: 'be brief', messages: [user('hello')] })
        const [caught, ...rest] = listCaughtLlmRequests()
        expect(rest).toEqual([])
        expect(caught).toMatchObject({
            purpose: 'fixture-echo',
            system: 'be brief',
            messages: [user('hello')],
            tools: null,
        })
        expect(Number.isNaN(Date.parse(caught!.at))).toBe(false)
    })

    test('stream catches once consumed, with a null system when none was sent', async () => {
        const { fakeLlm, listCaughtLlmRequests } = await import('./llm')
        for await (const chunk of fakeLlm.stream({ purpose: 'fixture-echo', messages: [user('streamed')] })) void chunk
        expect(listCaughtLlmRequests()).toMatchObject([
            { purpose: 'fixture-echo', system: null, messages: [user('streamed')], tools: null },
        ])
    })

    test('runToolLoop catches the tool definitions but never the execute closure', async () => {
        const { fakeLlm, listCaughtLlmRequests } = await import('./llm')
        const inputSchema = { type: 'object' as const, properties: { slug: { type: 'string' } }, required: ['slug'] }
        await fakeLlm.runToolLoop({
            purpose: 'fixture-echo',
            system: 'use the tools',
            messages: [user('look up depot')],
            tools: [{ name: 'lookup_depot', description: 'Find a depot by slug', inputSchema }],
            execute: async () => 'unused',
        })
        const [caught] = listCaughtLlmRequests()
        expect(caught).toMatchObject({
            purpose: 'fixture-echo',
            system: 'use the tools',
            messages: [user('look up depot')],
        })
        expect(caught!.tools).toEqual([{ name: 'lookup_depot', description: 'Find a depot by slug', inputSchema }])
        // On disk too: a closure cannot survive JSON, and nothing about the request's `execute` leaks.
        expect(JSON.stringify(caught)).not.toContain('execute')
    })

    test('a request that matches no fixture is still caught before the lookup throws', async () => {
        const { fakeLlm, listCaughtLlmRequests } = await import('./llm')
        await expect(fakeLlm.complete({ purpose: 'never-recorded', messages: [user('lost')] })).rejects.toThrow(
            /llm:record/,
        )
        await expect(
            fakeLlm.runToolLoop({
                purpose: 'never-recorded',
                messages: [user('lost too')],
                tools: [],
                execute: async () => '',
            }),
        ).rejects.toThrow(/never-recorded/)
        expect(listCaughtLlmRequests().map((c) => c.messages[0]!.content)).toEqual(['lost', 'lost too'])
    })

    test('lists oldest first (even within one millisecond) and filters by purpose', async () => {
        const { fakeLlm, listCaughtLlmRequests } = await import('./llm')
        for (const n of [1, 2, 3, 4, 5]) await fakeLlm.complete({ purpose: 'fixture-echo', messages: [user(`q${n}`)] })
        await expect(fakeLlm.complete({ purpose: 'never-recorded', messages: [user('other')] })).rejects.toThrow()

        expect(listCaughtLlmRequests().map((c) => c.messages[0]!.content)).toEqual([
            'q1',
            'q2',
            'q3',
            'q4',
            'q5',
            'other',
        ])
        expect(listCaughtLlmRequests('never-recorded').map((c) => c.messages[0]!.content)).toEqual(['other'])
        expect(listCaughtLlmRequests('nothing-sent-this')).toEqual([])
    })

    test('clear empties the catch', async () => {
        const { fakeLlm, listCaughtLlmRequests, clearCaughtLlmRequests } = await import('./llm')
        await fakeLlm.complete({ purpose: 'fixture-echo', messages: [user('x')] })
        expect(listCaughtLlmRequests()).toHaveLength(1)
        clearCaughtLlmRequests()
        expect(listCaughtLlmRequests()).toEqual([])
    })
})

describe('fake db (pglite)', () => {
    // pglite cold-start + migrations can exceed the 5s default when the whole verify gate runs in parallel
    test('migrates, seeds both tenants, and withTenant scopes context', { timeout: 20_000 }, async () => {
        const { fakeDb } = await import('./db')
        await fakeDb.migrateToLatest()
        const tenants = await fakeDb.getDb().selectFrom('tenants').selectAll().execute()
        const slugs = tenants.map((t) => t.slug).sort()
        // Exact, not a superset: the fixture world has EXACTLY two tenants (packages/keel/test-fixture
        // /seed.ts), and this is the assertion that pins that down.
        expect(slugs).toEqual(['harbor', 'lakeside'])

        const alpha = tenants.find((t) => t.slug === 'harbor')!
        const seen = await fakeDb.withTenant(alpha.id, async (trx) => {
            const rows = await trx.selectFrom('tenants').select('slug').execute()
            return rows.map((r) => r.slug)
        })
        expect(seen).toContain('harbor')
    })
})
