import { isSimulated, storage } from 'keel/adapters/index'
import { verifyUploadFields } from 'keel/adapters/fake/storage'
import { ATTACHMENT_MAX_BYTES } from '@/domain/attachments'

/**
 * The simulated-mode-only twin of an S3 presigned POST target. Real mode uploads go straight to
 * the S3 bucket URL that createRealStorage minted, so this endpoint 404s outside simulated mode first-line,
 * exactly like /api/storage/[...key]. It accepts the SAME multipart shape S3 would — the signed policy
 * fields first, the file last — and enforces the SAME constraints AWS would, approximating the status
 * codes S3 returns:
 *   - bad / missing signature  → 403 (S3 SignatureDoesNotMatch)
 *   - declared type ≠ signed   → 403 (S3 policy `eq $Content-Type` failure)
 *   - file over the ceiling    → 400 (S3 EntityTooLarge)
 *   - missing file part        → 400
 *   - success                  → 204 (S3's default, no success_action_status)
 *
 * There is no user session here: the target was AUTHORIZED when POST /api/attachments minted it (a
 * create-Attachment ability check), and the HMAC signature over {key, content-type, max-bytes,
 * expires} proves these fields weren't tampered with since — the same trust model as the shared
 * webhook secret, with the same 15-minute lifetime as a real presigned POST. The server-built key
 * means a caller can't redirect bytes; resolveKey rejects escapes as a backstop.
 */
export async function POST(request: Request): Promise<Response> {
    if (!isSimulated) return Response.json({ error: 'not found' }, { status: 404 })

    // Cheap pre-parse guard: formData() buffers the whole body BEFORE the signature check, so an
    // unauthenticated caller could otherwise force multi-GB buffering. Dev-only exposure (real
    // uploads go straight to S3, which enforces content-length-range pre-storage), but rejecting on
    // the declared length first costs nothing. The post-read byteLength check remains the real limit.
    const declared = Number(request.headers.get('content-length') ?? 0)
    if (declared > ATTACHMENT_MAX_BYTES * 2) return Response.json({ error: 'too-large' }, { status: 400 })

    const form = await request.formData()
    const fields = {
        key: form.get('key')?.toString(),
        'content-type': form.get('content-type')?.toString(),
        'max-bytes': form.get('max-bytes')?.toString(),
        expires: form.get('expires')?.toString(),
        signature: form.get('signature')?.toString(),
    }
    const verified = verifyUploadFields(fields)
    if (!verified) return Response.json({ error: 'signature-invalid' }, { status: 403 })

    const file = form.get('file')
    if (!(file instanceof File)) return Response.json({ error: 'missing-file' }, { status: 400 })
    // The browser stamps the file part's type from File.type; a mismatch is S3's `eq $Content-Type`
    // policy failure. An empty type (some files report none) rides on the signed content-type.
    if (file.type && file.type !== verified.contentType) {
        return Response.json({ error: 'content-type-mismatch' }, { status: 403 })
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.byteLength > verified.maxBytes) return Response.json({ error: 'too-large' }, { status: 400 })

    await storage.put(verified.key, bytes, verified.contentType)
    return new Response(null, { status: 204 })
}
