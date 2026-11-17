import {
    CopyObjectCommand,
    DeleteObjectsCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    S3Client,
} from '@aws-sdk/client-s3'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { NotFoundError, PreconditionFailedError } from '../../ports/errors'
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

/** What S3 throws: an Error whose `name` is the error code. */
const s3Error = (name: string, message: string) => Object.assign(new Error(message), { name })

describe('real storage copy', () => {
    test('sends exactly one CopyObject, server-side, with the content type and metadata carried over', async () => {
        send.mockResolvedValueOnce({})

        await expect(storage().copy('uploads/t1/abc/report.pdf', 't1/report.pdf')).resolves.toBeUndefined()

        const sent = sentOfType(CopyObjectCommand)
        expect(send).toHaveBeenCalledTimes(1)
        // Exact, not toMatchObject: no ContentType (ignored under COPY, and it would suggest the type is
        // rewritten), no conditional header (an existing destination is overwritten, as `put` does), no
        // other bucket than the adapter's own.
        expect(sent[0]!.input).toStrictEqual({
            Bucket: 'bucket-under-test',
            Key: 't1/report.pdf',
            CopySource: 'bucket-under-test/uploads/t1/abc/report.pdf',
            MetadataDirective: 'COPY',
        })
    })

    test.each([
        ['a space', 'reports/Q1 2026/summary.pdf', 'reports/Q1%202026/summary.pdf'],
        [
            'a plus, which URL decoding can read as a space',
            'files/c++ notes+draft.txt',
            'files/c%2B%2B%20notes%2Bdraft.txt',
        ],
        ['unicode', 'docs/résumé/日本語.pdf', 'docs/r%C3%A9sum%C3%A9/%E6%97%A5%E6%9C%AC%E8%AA%9E.pdf'],
        ['a question mark, which would start ?versionId=', 'a/what?versionId=1', 'a/what%3FversionId%3D1'],
        ['a percent sign, which would start an escape', 'a/100%/%41', 'a/100%25/%2541'],
        ['a hash, an ampersand and a semicolon', 'a/#1&b;c', 'a/%231%26b%3Bc'],
        ['empty segments, kept as they are', 'a//b/', 'a//b/'],
    ])('encodes the source key: %s', async (_label, key, encoded) => {
        send.mockResolvedValueOnce({})

        await storage().copy(key, 'dest/x')

        const input = sentOfType(CopyObjectCommand)[0]!.input
        expect(input.CopySource).toBe(`bucket-under-test/${encoded}`)
        // Nothing is lost: decoding each segment gives the key back.
        expect(input.CopySource!.slice('bucket-under-test/'.length).split('/').map(decodeURIComponent).join('/')).toBe(
            key,
        )
        // The DESTINATION is a `Key` field, which the SDK sends in the URL itself, so it is never encoded here.
        expect(input.Key).toBe('dest/x')
    })

    test('the source bucket is always the adapter’s own: a key cannot name another one or climb out', async () => {
        send.mockResolvedValue({})

        await storage().copy('other-bucket/secret.txt', 'mine/x')
        await storage().copy('/leading/slash', 'mine/y')
        await storage().copy('../other-bucket/z', 'mine/z')

        expect(sentOfType(CopyObjectCommand).map((c) => c.input.CopySource)).toEqual([
            'bucket-under-test/other-bucket/secret.txt',
            'bucket-under-test//leading/slash',
            'bucket-under-test/../other-bucket/z',
        ])
        expect(sentOfType(CopyObjectCommand).every((c) => c.input.Bucket === 'bucket-under-test')).toBe(true)
    })

    test('a missing source is a NotFoundError, as in the fake', async () => {
        send.mockRejectedValueOnce(s3Error('NoSuchKey', 'The specified key does not exist.'))

        const failure = storage().copy('uploads/gone', 'final/gone')

        await expect(failure).rejects.toBeInstanceOf(NotFoundError)
        await expect(failure).rejects.toThrow(/uploads\/gone/)
    })

    test('every other S3 error reaches the caller as it came, including a missing bucket', async () => {
        const denied = s3Error('AccessDenied', 'Access Denied')
        const noBucket = s3Error('NoSuchBucket', 'The specified bucket does not exist')
        send.mockRejectedValueOnce(denied).mockRejectedValueOnce(noBucket)

        await expect(storage().copy('a', 'b')).rejects.toBe(denied)
        // A misconfigured bucket is not a missing object, and must not be reported as one.
        await expect(storage().copy('a', 'b')).rejects.toBe(noBucket)
    })

    test('an object over the 5 GB one CopyObject can copy fails saying so, not with S3’s wording', async () => {
        send.mockRejectedValueOnce(
            s3Error(
                'InvalidRequest',
                'The specified copy source is larger than the maximum allowable size for a copy source: 5368709120',
            ),
        )

        const failure = storage().copy('imports/huge.bin', 'final/huge.bin')

        await expect(failure).rejects.toThrow(/imports\/huge\.bin is over the 5 GB one CopyObject call can copy/)
        await expect(failure).rejects.not.toBeInstanceOf(NotFoundError)
    })

    test('some other InvalidRequest is not mistaken for the size limit', async () => {
        const other = s3Error('InvalidRequest', 'Something else is wrong with this request')
        send.mockRejectedValueOnce(other)
        await expect(storage().copy('a', 'b')).rejects.toBe(other)
    })

    test('copying an object onto itself is refused before any request, as in the fake', async () => {
        await expect(storage().copy('same/key', 'same/key')).rejects.toThrow(/same key: same\/key/)
        expect(send).not.toHaveBeenCalled()
    })
})

describe('real storage head', () => {
    const modified = new Date('2026-11-16T12:00:00Z')

    test('sends exactly one HeadObject for the key as given, and reports size, type, ETag and date', async () => {
        send.mockResolvedValueOnce({
            ContentLength: 434234,
            ContentType: 'application/pdf',
            ETag: '"fba9dede5f27731c9771645a39863328"',
            LastModified: modified,
        })

        const info = await storage().head('staging/t1/abc/Q1 report+draft?.pdf')

        expect(send).toHaveBeenCalledTimes(1)
        // The key goes in the `Key` field, which the SDK puts in the URL itself: never encoded here.
        expect(sentOfType(HeadObjectCommand)[0]!.input).toStrictEqual({
            Bucket: 'bucket-under-test',
            Key: 'staging/t1/abc/Q1 report+draft?.pdf',
        })
        expect(info).toStrictEqual({
            size: 434234,
            contentType: 'application/pdf',
            // exactly as S3 sent it, quotes included: it is opaque, and `copy`'s ifMatch must get it back unchanged
            etag: '"fba9dede5f27731c9771645a39863328"',
            lastModified: modified,
        })
    })

    test('a size of zero is a size of zero, and a missing content type is the same default as get', async () => {
        send.mockResolvedValueOnce({
            ContentLength: 0,
            ETag: '"d41d8cd98f00b204e9800998ecf8427e"',
            LastModified: modified,
        })

        expect(await storage().head('empty')).toMatchObject({ size: 0, contentType: 'application/octet-stream' })
    })

    test.each(['NotFound', 'NoSuchKey'])('a missing object (%s) is null, as in get and the fake', async (name) => {
        send.mockRejectedValueOnce(s3Error(name, 'not here'))
        expect(await storage().head('nope')).toBeNull()
    })

    test('a 403 (no s3:ListBucket), a missing bucket named as such, and every other error reach the caller as they came', async () => {
        const errors = [
            s3Error('Forbidden', 'Forbidden'),
            s3Error('AccessDenied', 'Access Denied'),
            s3Error('NoSuchBucket', 'The specified bucket does not exist'),
            s3Error('InternalError', 'try again'),
        ]
        for (const error of errors) {
            send.mockRejectedValueOnce(error)
            await expect(storage().head('k')).rejects.toBe(error)
        }
    })

    test.each([
        ['ContentLength', { ETag: '"e"', LastModified: modified }],
        ['ETag', { ContentLength: 1, LastModified: modified }],
        ['LastModified', { ContentLength: 1, ETag: '"e"' }],
    ])('an answer without %s throws instead of reporting something S3 never said', async (_name, answer) => {
        send.mockResolvedValueOnce(answer)
        await expect(storage().head('k')).rejects.toThrow(/without a ContentLength, ETag and LastModified/)
    })
})

describe('real storage copy with ifMatch', () => {
    test('sends CopySourceIfMatch with the etag exactly as given, and nothing else conditional', async () => {
        send.mockResolvedValueOnce({})

        await storage().copy('staging/a', 'final/a', { ifMatch: '"fba9dede5f27731c9771645a39863328"' })

        expect(sentOfType(CopyObjectCommand)[0]!.input).toStrictEqual({
            Bucket: 'bucket-under-test',
            Key: 'final/a',
            CopySource: 'bucket-under-test/staging/a',
            MetadataDirective: 'COPY',
            CopySourceIfMatch: '"fba9dede5f27731c9771645a39863328"',
        })
    })

    test('the etag head returned goes to CopyObject unchanged (head, then copy, as finalize does)', async () => {
        send.mockResolvedValueOnce({ ContentLength: 5, ETag: '"abc"', LastModified: new Date() })
        send.mockResolvedValueOnce({})

        const info = (await storage().head('staging/a'))!
        await storage().copy('staging/a', 'final/a', { ifMatch: info.etag })

        expect(sentOfType(CopyObjectCommand)[0]!.input.CopySourceIfMatch).toBe(info.etag)
    })

    test('no options, or options without ifMatch, send no condition at all', async () => {
        send.mockResolvedValue({})
        await storage().copy('a', 'b')
        await storage().copy('a', 'c', {})
        for (const command of sentOfType(CopyObjectCommand))
            expect(command.input).not.toHaveProperty('CopySourceIfMatch')
    })

    test.each([
        [
            'named PreconditionFailed',
            s3Error('PreconditionFailed', 'At least one of the pre-conditions you specified did not hold'),
        ],
        ['a bare 412', Object.assign(new Error('x'), { name: 'Unknown', $metadata: { httpStatusCode: 412 } })],
    ])('a source that no longer matches (%s) is a PreconditionFailedError', async (_label, error) => {
        send.mockRejectedValueOnce(error)

        const failure = storage().copy('staging/a', 'final/a', { ifMatch: '"old"' })

        await expect(failure).rejects.toBeInstanceOf(PreconditionFailedError)
        await expect(failure).rejects.toThrow(/staging\/a is no longer the version "old"; nothing was copied/)
    })

    test('a missing source is still a NotFoundError when an ifMatch was given, and other errors are unchanged', async () => {
        const denied = s3Error('AccessDenied', 'Access Denied')
        send.mockRejectedValueOnce(s3Error('NoSuchKey', 'gone')).mockRejectedValueOnce(denied)

        await expect(storage().copy('a', 'b', { ifMatch: '"x"' })).rejects.toBeInstanceOf(NotFoundError)
        await expect(storage().copy('a', 'b', { ifMatch: '"x"' })).rejects.toBe(denied)
    })

    test.each(['', ' ', '*', ' * '])(
        'an ifMatch of %j is refused before any request: HTTP gives it a meaning no etag has',
        async (ifMatch) => {
            await expect(storage().copy('a', 'b', { ifMatch })).rejects.toThrow(/not empty and not "\*"/)
            // first of all: before the same-key check too, as in the fake
            await expect(storage().copy('same', 'same', { ifMatch })).rejects.toThrow(/not empty and not "\*"/)
            expect(send).not.toHaveBeenCalled()
        },
    )

    test('the refusal names the version when there is one, and not "undefined" when a 412 comes back unasked', async () => {
        send.mockRejectedValueOnce(s3Error('PreconditionFailed', 'x'))
        await expect(storage().copy('staging/a', 'final/a')).rejects.toThrow(
            /staging\/a is no longer the version \(none given\)/,
        )
    })

    test('a copy onto itself is refused before any request even with an ifMatch', async () => {
        await expect(storage().copy('same', 'same', { ifMatch: '"x"' })).rejects.toThrow(/same key/)
        expect(send).not.toHaveBeenCalled()
    })
})
