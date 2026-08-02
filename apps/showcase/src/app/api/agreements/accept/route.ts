import { auth, db } from 'keel/adapters/index'
import { authorize } from 'keel/authz/authorize'
import { recordAuditEvent } from 'keel/db/audit'
import { readAgreement, recordAcceptance } from 'keel/db/agreements'
import { resolveOrgContext } from '../../org-context'
import { withPortErrors } from '../../respond'

/**
 * Accept an agreement FOR YOURSELF — the resolution flow behind a pending agreement gate.
 * A user records only their own acceptance (self-only ability rule, like notification prefs); the
 * userId is always the session's, never client-supplied. The accepted VERSION is read server-side
 * from the current agreement row (never trusted from the client) and denormalized onto the
 * append-only acceptance, then the protected layout re-evaluates gates naturally on the next render.
 *
 * NO GATE LOOP: this route lives under /api (NOT under the (protected) layout that renders the
 * interstitial), so it stays reachable even while a blocking gate is active — the interstitial POSTs
 * here and reloads. The signin and accept-invite flows are likewise OUTSIDE (protected), so they are
 * never gated either. In v1 there is no separate resolution ROUTE to allowlist: the interstitial is
 * rendered in-place inside the protected layout.
 */
export async function POST(request: Request): Promise<Response> {
    return withPortErrors(async () => {
        const user = await auth.requireUser()
        // Self-only authorization: accept for myself. Throws ForbiddenError → 403 via withPortErrors.
        authorize(user, user.orgSlug, 'create', { type: 'AgreementAcceptance', ownerId: user.id })

        const { agreementId } = (await request.json()) as { agreementId?: unknown }
        if (typeof agreementId !== 'string' || !agreementId) {
            return Response.json({ error: 'invalid-agreement' }, { status: 400 })
        }

        // audit_events.org_id is NOT NULL; the acceptance happened while acting in this org.
        const resolved = await resolveOrgContext(user)
        if (resolved instanceof Response) return resolved
        const { tenantId, orgId } = resolved

        // Read the CURRENT version server-side — the client never dictates which version was accepted.
        // Recorded tradeoff (pre-merge review): if an operator bumps between render and click, the row
        // records the NEW version though the user saw the old text — the narrow-window flip side of
        // refusing forgeable client-supplied versions, which would be the worse failure.
        const agreement = await readAgreement(db, tenantId, agreementId)
        if (!agreement) return Response.json({ error: 'unknown agreement' }, { status: 404 })

        // Minimal capture context (kept small on purpose — user-agent only).
        const userAgent = (request.headers.get('user-agent') ?? '').slice(0, 256)

        const acceptance = await recordAcceptance(db, {
            tenantId,
            agreementId,
            agreementVersion: agreement.version,
            userId: user.id,
            metadata: { userAgent },
        })

        await recordAuditEvent(db, {
            tenantId,
            orgId,
            actorUserId: user.id,
            action: 'agreement.accepted',
            subjectType: 'AgreementAcceptance',
            subjectId: acceptance.id,
        })

        return Response.json({ ok: true, version: agreement.version })
    })
}
