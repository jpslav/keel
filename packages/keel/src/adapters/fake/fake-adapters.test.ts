import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { makeTestTmpDir } from '../../../../../tests/support/tmp-dir'

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
