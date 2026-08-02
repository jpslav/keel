import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import type { StoragePort, StoredObject } from '../../ports/storage'

/** AUTHORED — CUTOVER (`cloud-accounts`): typechecked, never run against a real bucket. */
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
