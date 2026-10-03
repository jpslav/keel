import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createRealStorage } from './storage'

/**
 * The real storage adapter has never run against a bucket (cutover row `cloud-accounts`), but how it
 * pages and batches is plain control flow, so it is proven here with the SDK's transport replaced:
 * `S3Client.prototype.send` is the single choke point every command goes through.
 */
type Send = (command: unknown) => Promise<unknown>
let send: ReturnType<typeof vi.fn<Send>>

beforeEach(() => {
    send = vi.fn<Send>()
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(send as never)
})
afterEach(() => {
    vi.restoreAllMocks()
})

const storage = () => createRealStorage('bucket-under-test', 'us-east-1')
const sentOfType = <T>(command: new (...args: never[]) => T) =>
    send.mock.calls.map(([sent]) => sent).filter((sent): sent is T => sent instanceof command)

describe('real storage list', () => {
    test('follows the continuation token across pages, concatenates, and sorts', async () => {
        send.mockResolvedValueOnce({
            Contents: [{ Key: 'docs/c' }, { Key: 'docs/a' }],
            IsTruncated: true,
            NextContinuationToken: 'page-2',
        })
        send.mockResolvedValueOnce({ Contents: [{ Key: 'docs/b' }], IsTruncated: false })

        expect(await storage().list('docs/')).toEqual(['docs/a', 'docs/b', 'docs/c'])

        const sent = sentOfType(ListObjectsV2Command)
        expect(sent).toHaveLength(2)
        expect(sent[0]!.input).toMatchObject({ Bucket: 'bucket-under-test', Prefix: 'docs/' })
        expect(sent[0]!.input.ContinuationToken).toBeUndefined()
        expect(sent[1]!.input.ContinuationToken).toBe('page-2')
    })

    test('an empty listing (no Contents at all) is []', async () => {
        send.mockResolvedValueOnce({ IsTruncated: false })
        expect(await storage().list('nothing/')).toEqual([])
    })
})

describe('real storage delete', () => {
    test('batches at the 1000-key cap and asks for a quiet response', async () => {
        send.mockResolvedValue({})
        const keys = Array.from({ length: 2500 }, (_, i) => `k/${i}`)

        await storage().delete(keys)

        const sent = sentOfType(DeleteObjectsCommand)
        expect(sent.map((c) => c.input.Delete!.Objects!.length)).toEqual([1000, 1000, 500])
        expect(sent.every((c) => c.input.Delete!.Quiet === true)).toBe(true)
        expect(sent[2]!.input.Delete!.Objects![499]!.Key).toBe('k/2499')
    })

    test('an empty key list sends no request at all', async () => {
        await storage().delete([])
        expect(send).not.toHaveBeenCalled()
    })

    test('a per-key failure in the response throws, naming the key and the reason', async () => {
        send.mockResolvedValueOnce({ Errors: [{ Key: 'locked/x', Code: 'AccessDenied', Message: 'nope' }] })
        await expect(storage().delete(['ok/y', 'locked/x'])).rejects.toThrow(/locked\/x.*AccessDenied.*nope/)
    })
})
