import { auth, db, storage } from 'keel/adapters/index'
import { authorize } from 'keel/authz/authorize'
import { ATTACHMENT_MAX_BYTES, isAttachmentKind, sanitizeFilename } from '@/domain/attachments'
import { recordAuditEvent } from 'keel/db/audit'
import { createAttachment, listAttachments } from '@/domain/db/attachments'
import { resolveOrgContext } from '../org-context'
import { withPortErrors } from '../respond'

/**
 * Typed attachments: browser-uploaded files, tenant-scoped by RLS AND filtered to the active
 * org — the same two boundaries as tickets/jobs (ADR-0004). GET lists the team's ready
 * attachments each with a signed download URL. POST is the MINT step of a two-step upload: it authorizes,
 * builds a SERVER-SIDE storage key, records a pending row, and hands back a presigned upload target the
 * browser POSTs the file to directly; POST /api/attachments/[id]/confirm then finalizes the row.
 */
export async function GET(): Promise<Response> {
    return withPortErrors(async () => {
        const user = await auth.requireUser()
        const resolved = await resolveOrgContext(user)
        if (resolved instanceof Response) return resolved
        const { tenantId, orgId } = resolved

        const rows = await listAttachments(db, tenantId, orgId)
        // Each ready attachment's bytes live in storage; hand the browser a time-limited download URL.
        const attachments = await Promise.all(
            rows.map(async ({ storageKey, ...view }) => ({
                ...view,
                downloadUrl: await storage.getSignedDownloadUrl(storageKey),
            })),
        )
        return Response.json({ attachments })
    })
}

export async function POST(request: Request): Promise<Response> {
    return withPortErrors(async () => {
        const user = await auth.requireUser()
        const {
            filename,
            contentType,
            kind = 'attachment',
            sizeBytes,
        } = (await request.json()) as {
            filename?: string
            contentType?: string
            kind?: string
            sizeBytes?: number
        }
        if (!filename?.trim()) return Response.json({ error: 'missing-filename' }, { status: 400 })
        if (!isAttachmentKind(kind)) return Response.json({ error: 'unknown-kind' }, { status: 400 })
        // Fail fast when the client already knows the file is over the ceiling (the upload target
        // enforces it for real — this just avoids minting a doomed pending row).
        if (typeof sizeBytes === 'number' && sizeBytes > ATTACHMENT_MAX_BYTES) {
            return Response.json({ error: 'too-large' }, { status: 400 })
        }
        const type = contentType?.trim() || 'application/octet-stream'
        // Printable ASCII only: control chars (esp. newlines) would ambiguate the fake target's
        // canonical HMAC string and pollute the real S3 policy/Content-Type header.
        if (!/^[\x20-\x7e]{1,255}$/.test(type)) {
            return Response.json({ error: 'invalid-content-type' }, { status: 400 })
        }

        const resolved = await resolveOrgContext(user)
        if (resolved instanceof Response) return resolved
        const { tenantId, orgId } = resolved

        // Authorization choke point: restricted members may read attachments but not upload.
        authorize(user, orgId, 'create', { type: 'Attachment', orgId })

        // The storage key is built ENTIRELY server-side — tenant + a fresh uuid + the sanitized name —
        // so the client can never steer where bytes land (the resultKey prefix-lock lesson).
        const storageKey = `attachments/${tenantId}/${crypto.randomUUID()}/${sanitizeFilename(filename)}`
        const { id } = await createAttachment(db, {
            tenantId,
            orgId,
            kind,
            filename: filename.trim(),
            contentType: type,
            storageKey,
            uploadedByUserId: user.id,
        })
        const upload = await storage.createUploadTarget(storageKey, {
            contentType: type,
            maxBytes: ATTACHMENT_MAX_BYTES,
        })
        // Audit trail: record the mint. The matching attachment.confirmed event lands when the
        // browser finalizes the upload — a minted-but-never-confirmed row leaves only this event, which
        // is exactly the honest record (someone started an upload that never completed).
        await recordAuditEvent(db, {
            tenantId,
            orgId,
            actorUserId: user.id,
            action: 'attachment.minted',
            subjectType: 'Attachment',
            subjectId: id,
        })
        return Response.json({ attachmentId: id, upload }, { status: 201 })
    })
}
