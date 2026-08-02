/**
 * FIXTURE ROUTE — SCANNED, NEVER SERVED. See ../dockets/route.ts for what this tree is.
 *
 * THIS FILE backs the `storage-upload/route.ts` EXACT exemption: the simulated-mode local twin of an
 * S3 presigned POST, authenticated by server-signed HMAC upload-target fields rather than a session —
 * the upload TARGET was authorized when it was minted. Simulated-mode only, so its exemption carries
 * the `if (!isSimulated)` `mustMatch` gate.
 */
const isSimulated: boolean = true

export async function POST(): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return Response.json({ ok: true })
}
