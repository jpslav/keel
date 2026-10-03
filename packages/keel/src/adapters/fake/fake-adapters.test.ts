import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

// Point all fake-adapter state at a throwaway dir BEFORE importing the adapters.
const tmp = mkdtempSync(path.join(tmpdir(), 'app-fakes-'))
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
