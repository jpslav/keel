import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeTestTmpDir } from '../../../../../../tests/support/tmp-dir'
import { fakeStorage } from 'keel/adapters/fake/storage'
import { POST } from './route'

// Point fake-adapter state at a throwaway dir BEFORE any storage call (the HMAC secret + the bytes
// both live under it). The route reads `storage` + `isSimulated` from @/adapters — we mock that module
// (vi.mock is hoisted above the imports) to the REAL fake storage singleton, so signatures verify
// against the same secret, with a toggleable isSimulated; verifyUploadFields (imported directly by the
// route from @/adapters/fake/storage) stays real.
const tmp = makeTestTmpDir('app-upload-')
const adaptersState = vi.hoisted(() => ({ fake: true }))
vi.mock('keel/adapters/index', async () => {
    const actual = await import('keel/adapters/fake/storage')
    return {
        get isSimulated() {
            return adaptersState.fake
        },
        storage: actual.fakeStorage,
    }
})

beforeAll(() => {
    process.env.APP_DATA_DIR = tmp
})
afterAll(() => {
    delete process.env.APP_DATA_DIR
})
beforeEach(() => {
    adaptersState.fake = true
})

function makeRequest(fields: Record<string, string>, file?: File): Request {
    const form = new FormData()
    for (const [k, v] of Object.entries(fields)) form.append(k, v)
    if (file) form.append('file', file)
    return new Request('http://localhost/api/storage-upload', { method: 'POST', body: form })
}

const KEY = 'attachments/tenant-northwind/uuid-abc/hello.txt'

describe('POST /api/storage-upload (fake presigned-POST twin)', () => {
    test('204 accepts a valid signed multipart POST and stores the bytes', async () => {
        const target = await fakeStorage.createUploadTarget(KEY, { contentType: 'text/plain', maxBytes: 1000 })
        const file = new File([new TextEncoder().encode('hello world')], 'hello.txt', { type: 'text/plain' })

        const response = await POST(makeRequest(target.fields, file))
        expect(response.status).toBe(204)

        const stored = await fakeStorage.get(KEY)
        expect(stored).not.toBeNull()
        expect(new TextDecoder().decode(stored!.body)).toBe('hello world')
        expect(stored!.contentType).toBe('text/plain')
    })

    test('403 on a tampered signature (S3 SignatureDoesNotMatch)', async () => {
        const target = await fakeStorage.createUploadTarget(KEY, { contentType: 'text/plain', maxBytes: 1000 })
        const file = new File([new Uint8Array([1, 2, 3])], 'hello.txt', { type: 'text/plain' })
        const response = await POST(makeRequest({ ...target.fields, signature: 'forged' }, file))
        expect(response.status).toBe(403)
    })

    test('403 when the file type differs from the signed content-type (S3 eq $Content-Type)', async () => {
        const target = await fakeStorage.createUploadTarget(KEY, { contentType: 'text/plain', maxBytes: 1000 })
        const file = new File([new Uint8Array([1, 2, 3])], 'hello.txt', { type: 'text/html' })
        const response = await POST(makeRequest(target.fields, file))
        expect(response.status).toBe(403)
    })

    test('400 when the file exceeds the signed size ceiling (S3 EntityTooLarge)', async () => {
        const target = await fakeStorage.createUploadTarget(KEY, { contentType: 'text/plain', maxBytes: 3 })
        const file = new File([new TextEncoder().encode('way too many bytes')], 'hello.txt', { type: 'text/plain' })
        const response = await POST(makeRequest(target.fields, file))
        expect(response.status).toBe(400)
    })

    test('400 when the file part is missing', async () => {
        const target = await fakeStorage.createUploadTarget(KEY, { contentType: 'text/plain', maxBytes: 1000 })
        const response = await POST(makeRequest(target.fields))
        expect(response.status).toBe(400)
    })

    test('404 outside simulated mode (real uploads go straight to S3)', async () => {
        adaptersState.fake = false
        const target = await fakeStorage.createUploadTarget(KEY, { contentType: 'text/plain', maxBytes: 1000 })
        const file = new File([new Uint8Array([1])], 'hello.txt', { type: 'text/plain' })
        const response = await POST(makeRequest(target.fields, file))
        expect(response.status).toBe(404)
    })
})
