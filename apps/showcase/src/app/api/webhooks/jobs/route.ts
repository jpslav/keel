import { auth, db } from 'keel/adapters/index'
import { recordWebhookCompletion } from 'keel/db/jobs'
import { notifyJobTerminal } from 'keel/server-lib/notify'
import { makeNotifyDeps } from 'keel/server-lib/notify-deps'
import { withWebhookSecret } from '../respond'

/**
 * Inbound job-completion webhook (real: the CodeBuild build's final POST). Hand-rolled payload guard
 * — no zod, validation stays explicit at this trust boundary. Idempotent by construction: a
 * redelivery of an already-terminal job returns 200 with `idempotent: true` rather than erroring;
 * an unknown job is a 404 (NotFoundError → withPortErrors); a genuinely illegal transition is a 409.
 * Auth is the shared webhook secret, checked by withWebhookSecret before this handler runs.
 */
export const POST = withWebhookSecret(async ({ request }) => {
    const invalid = () => Response.json({ error: 'invalid-payload' }, { status: 400 })
    const body = (await request.json()) as Record<string, unknown> | null
    if (typeof body !== 'object' || body === null) return invalid()

    const { jobId, tenantId, status, resultKey, error } = body
    if (typeof jobId !== 'string' || typeof tenantId !== 'string') return invalid()
    if (status !== 'completed' && status !== 'failed') return invalid()
    if (resultKey !== undefined && typeof resultKey !== 'string') return invalid()
    if (error !== undefined && typeof error !== 'string') return invalid()
    // Cheap pre-DB reject: a resultKey must at least sit in the named tenant's namespace. The org
    // half of the check lives in recordWebhookCompletion, where the job row is the authority.
    if (resultKey !== undefined && !resultKey.startsWith(`exports/${tenantId}/`)) return invalid()

    const outcome = await recordWebhookCompletion(db, { tenantId, jobId, status, resultKey, error })
    if (outcome === 'invalid-result-key') return invalid()
    // Notification fan-out: notify the job's org admins on a REAL terminal transition (not an
    // idempotent redelivery — that already notified). The seam filters to user-facing kinds and resolves
    // the org itself. After-commit, beside the status write.
    if (outcome === 'applied') {
        await notifyJobTerminal(await makeNotifyDeps(), auth, { tenantId, jobId, status })
    }
    return Response.json({ ok: true, idempotent: outcome === 'idempotent' })
})
