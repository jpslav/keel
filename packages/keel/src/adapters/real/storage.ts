import {
    CopyObjectCommand,
    DeleteObjectsCommand,
    GetObjectCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { NotFoundError, PreconditionFailedError } from '../../ports/errors'
import type { CopyOptions, StoragePort, StoredObject, StoredObjectInfo } from '../../ports/storage'

/** S3's hard cap on keys in one DeleteObjects request. */
const DELETE_BATCH_SIZE = 1000

/**
 * `CopySource` for an object in `bucket`: `<bucket>/<key>`, with each key SEGMENT percent-encoded and the
 * slashes between them left alone (the shape AWS documents: `awsexamplebucket/reports/january.pdf`). The
 * SDK sends the string as given and AWS says "The value must be URL-encoded", so a `?` left in a key would
 * start the `?versionId=` suffix AWS documents and a `%` would start an escape; a `+` is ambiguous in URL
 * decoding, so it is encoded too. The bucket is always the adapter's own, so a key can
 * never name another bucket: `other-bucket/x` is the key `other-bucket/x` of THIS one.
 */
function copySourceFor(bucket: string, key: string): string {
    return `${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * AUTHORED — CUTOVER (`cloud-accounts`; `list` and `delete` also `storage-list-delete`, `copy` also
 * `storage-copy`): typechecked, never run against a real bucket.
 */
export function createRealStorage(bucket: string, region: string): StoragePort {
    const client = new S3Client({ region })

    return {
        async put(key, body, contentType) {
            await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }))
        },

        async get(key): Promise<StoredObject | null> {
            try {
                const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
                const body = await result.Body!.transformToByteArray()
                return { body, contentType: result.ContentType ?? 'application/octet-stream' }
            } catch (error) {
                if ((error as { name?: string }).name === 'NoSuchKey') return null
                throw error
            }
        },

        async head(key): Promise<StoredObjectInfo | null> {
            let result
            try {
                result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
            } catch (error) {
                // `NotFound` is the SDK's error for a HEAD 404, which has no body to say which of key and bucket
                // is missing (AWS: "It's not possible to retrieve the exact exception"), so a missing bucket reads
                // as null too. `NoSuchKey` for a stub or a future SDK that does say. A 403 (no `s3:ListBucket`)
                // and everything else are not a missing object and reach the caller as they came.
                const { name } = error as { name?: string }
                if (name === 'NotFound' || name === 'NoSuchKey') return null
                throw error
            }
            // A size of 0 or an invented date would let a caller's check pass on something S3 never said.
            const { ContentLength, ContentType, ETag, LastModified } = result
            if (ContentLength === undefined || ETag === undefined || LastModified === undefined) {
                throw new Error(`storage head: S3 answered for ${key} without a ContentLength, ETag and LastModified`)
            }
            return {
                size: ContentLength,
                contentType: ContentType ?? 'application/octet-stream',
                etag: ETag,
                lastModified: LastModified,
            }
        },

        async getSignedDownloadUrl(key, expiresInSeconds = 900): Promise<string> {
            // Force attachment disposition so user-uploaded content (whose Content-Type the uploader
            // declared) can never render inline on the bucket/CDN origin — the stored-XSS defense the
            // fake download route applies with nosniff+attachment. Keep the two paths in parity.
            return getSignedUrl(
                client,
                new GetObjectCommand({
                    Bucket: bucket,
                    Key: key,
                    ResponseContentDisposition: 'attachment',
                }),
                { expiresIn: expiresInSeconds },
            )
        },

        async list(prefix) {
            const keys: string[] = []
            let continuationToken: string | undefined
            do {
                const page = await client.send(
                    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }),
                )
                for (const object of page.Contents ?? []) if (object.Key !== undefined) keys.push(object.Key)
                continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
            } while (continuationToken)
            return keys.sort()
        },

        async delete(keys) {
            for (let start = 0; start < keys.length; start += DELETE_BATCH_SIZE) {
                const batch = keys.slice(start, start + DELETE_BATCH_SIZE)
                // Quiet: S3 answers with failures only, so a clean batch has no `Errors` to read. A
                // missing key is not a failure (S3 reports it as deleted), which is the idempotency we promise.
                const result = await client.send(
                    new DeleteObjectsCommand({
                        Bucket: bucket,
                        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
                    }),
                )
                const failed = result.Errors?.[0]
                if (failed) {
                    throw new Error(`storage delete failed for ${failed.Key}: ${failed.Code} ${failed.Message}`)
                }
            }
        },

        async copy(from, to, options?: CopyOptions) {
            // A copy onto itself changes nothing, and is nearly always two keys built the same way by mistake:
            // refuse it before spending a request, with the same error the fake gives.
            if (from === to) throw new Error(`storage copy: source and destination are the same key: ${from}`)
            try {
                // One server-side CopyObject: the bytes never leave S3. `MetadataDirective: 'COPY'` carries the
                // content type and user metadata over (naming a ContentType here would be ignored under COPY).
                // An existing `to` is overwritten, as `put` does. If S3 answers 200 with an error in the body,
                // the SDK's own middleware turns that into a thrown error, so this never reports a false success.
                await client.send(
                    new CopyObjectCommand({
                        Bucket: bucket,
                        Key: to,
                        CopySource: copySourceFor(bucket, from),
                        MetadataDirective: 'COPY',
                        // Only when asked for: S3 then copies only if the source's ETag is this one. The value
                        // is exactly what `head` returned (an opaque string, quotes and all), never rebuilt.
                        ...(options?.ifMatch !== undefined ? { CopySourceIfMatch: options.ifMatch } : {}),
                    }),
                )
            } catch (error) {
                const { name, message, $metadata } = error as {
                    name?: string
                    message?: string
                    $metadata?: { httpStatusCode?: number }
                }
                // The source is no longer the version `ifMatch` names: S3's 412. (The CopyObject reference gives
                // 412 for its other conditional headers and no code for this one, which is HTTP's rule for a
                // failed If-Match; the cutover row asks to confirm it.) Nothing was copied.
                if (name === 'PreconditionFailed' || $metadata?.httpStatusCode === 412) {
                    throw new PreconditionFailedError(
                        `storage copy: ${from} is no longer the version ${options?.ifMatch}; nothing was copied`,
                    )
                }
                // A missing SOURCE. (A missing bucket is NoSuchBucket, a misconfiguration, and is not mapped.)
                if (name === 'NoSuchKey') throw new NotFoundError(`storage object not found: ${from}`)
                // One CopyObject copies at most 5 GB (AWS's CopyObject reference; UploadPartCopy is the route
                // above it). Say so rather than relay S3's wording.
                if (name === 'InvalidRequest' && /larger than the maximum allowable size/i.test(message ?? '')) {
                    throw new Error(
                        `storage copy: ${from} is over the 5 GB one CopyObject call can copy (multipart copy is not implemented)`,
                        { cause: error },
                    )
                }
                throw error
            }
        },

        async createUploadTarget(key, { contentType, maxBytes }) {
            // A presigned POST the browser uploads to directly. The Conditions ARE the security policy:
            // the object lands at exactly `key` (server-built — never client-chosen), its declared
            // Content-Type must equal `contentType`, and its size must fall within [0, maxBytes]. AWS
            // rejects any POST that violates them (403/400) before a byte is stored.
            const { url, fields } = await createPresignedPost(client, {
                Bucket: bucket,
                Key: key,
                Conditions: [
                    ['content-length-range', 0, maxBytes],
                    ['eq', '$Content-Type', contentType],
                ],
                Fields: { 'Content-Type': contentType },
                Expires: 900,
            })
            return { url, fields }
        },
    }
}
