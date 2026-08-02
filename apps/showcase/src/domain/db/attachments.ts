import { toIso } from 'keel/db/jobs'
import type { DbPort } from 'keel/ports/db'

/** An attachment as its owning team sees it in the list (a signed download URL is added by the route). */
export interface AttachmentView {
    id: string
    kind: string
    filename: string
    contentType: string
    sizeBytes: number | null
    createdAt: string
}

/**
 * Mints a pending attachment row: one tenant-scoped INSERT. `storageKey` is already SERVER-BUILT by the
 * route (`attachments/<tenant>/<uuid>/<name>`); RLS pins tenant_id, so a row can never be planted into
 * another tenant. The row stays `pending` — with no `size_bytes` and out of every list — until confirm
 * proves the upload landed.
 */
export async function createAttachment(
    db: DbPort,
    input: {
        tenantId: string
        orgId: string
        kind: string
        filename: string
        contentType: string
        storageKey: string
        uploadedByUserId: string
    },
): Promise<{ id: string }> {
    return db.withTenant(input.tenantId, (trx) =>
        trx
            .insertInto('attachments')
            .values({
                tenant_id: input.tenantId,
                org_id: input.orgId,
                kind: input.kind,
                filename: input.filename,
                content_type: input.contentType,
                storage_key: input.storageKey,
                uploaded_by_user_id: input.uploadedByUserId,
            })
            .returning('id')
            .executeTakeFirstOrThrow(),
    )
}

/**
 * Resolves an attachment id to its storage key + status ONLY when it belongs to `orgId` within
 * `tenantId` — returns null both when the attachment is absent AND when it belongs to another org (a
 * foreign org's attachment must be indistinguishable from a missing one, so ids can't be probed; the
 * jobForOrg doctrine). The confirm route uses the returned key to verify the upload actually landed.
 */
export async function attachmentForOrg(
    db: DbPort,
    tenantId: string,
    orgId: string,
    attachmentId: string,
): Promise<{ id: string; storageKey: string; status: string } | null> {
    return db.withTenant(tenantId, async (trx) => {
        const row = await trx
            .selectFrom('attachments')
            .select(['id', 'storage_key', 'status'])
            .where('id', '=', attachmentId)
            .where('org_id', '=', orgId)
            .executeTakeFirst()
        return row ? { id: row.id, storageKey: row.storage_key, status: row.status } : null
    })
}

/**
 * Finalizes an attachment: records the object's true `size_bytes` (read from storage by the route, never
 * client-declared) and flips `status` to `ready`, scoped to the owning org so a confirm can't touch
 * another team's row. Idempotent — re-confirming an already-ready attachment just rewrites the same
 * values. This is the ONLY UPDATE path (mint → confirm; there is no edit).
 */
export async function confirmAttachment(
    db: DbPort,
    tenantId: string,
    orgId: string,
    attachmentId: string,
    sizeBytes: number,
): Promise<number> {
    const result = await db.withTenant(tenantId, (trx) =>
        trx
            .updateTable('attachments')
            .set({ status: 'ready', size_bytes: sizeBytes })
            .where('id', '=', attachmentId)
            .where('org_id', '=', orgId)
            // pending-only: a re-confirm after ready is a no-op, so the recorded size can never be
            // silently rewritten once the attachment is live (upload targets also expire — belt+braces)
            .where('status', '=', 'pending')
            .execute(),
    )
    // 1 = flipped pending->ready now; 0 = already ready (idempotent re-confirm — the caller must
    // not record a second audit event for a write that didn't happen)
    return Number(result[0]?.numUpdatedRows ?? 0)
}

/**
 * Lists a team's READY attachments newest-first — tenant-scoped by RLS AND org-filtered, the same two
 * boundaries as listNotes/listJobs. Pending rows (upload not confirmed) are excluded, so every listed
 * attachment has bytes behind it and a live download link. `storageKey` rides along so the route can mint
 * a signed download URL per row.
 */
export async function listAttachments(
    db: DbPort,
    tenantId: string,
    orgId: string,
    opts?: { limit?: number },
): Promise<(AttachmentView & { storageKey: string })[]> {
    const limit = opts?.limit ?? 50
    return db.withTenant(tenantId, async (trx) => {
        const rows = await trx
            .selectFrom('attachments')
            .select(['id', 'kind', 'filename', 'content_type', 'size_bytes', 'storage_key', 'created_at'])
            .where('org_id', '=', orgId)
            .where('status', '=', 'ready')
            .orderBy('created_at', 'desc')
            .limit(limit)
            .execute()
        return rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            filename: r.filename,
            contentType: r.content_type,
            sizeBytes: r.size_bytes,
            createdAt: toIso(r.created_at),
            storageKey: r.storage_key,
        }))
    })
}
