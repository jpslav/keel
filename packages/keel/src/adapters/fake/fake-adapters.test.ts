import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeTestTmpDir } from '../../../../../tests/support/tmp-dir'
import { NotFoundError } from '../../ports/errors'

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
