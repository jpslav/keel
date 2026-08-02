import { db, isSimulated } from 'keel/adapters/index'
import { acceptInvite } from 'keel/adapters/fake/auth'
import { listAgreementsForTenant, recordAcceptance } from 'keel/db/agreements'
import { tenantIdForSlug } from 'keel/db/tenant-lookup'
import { withPortErrors } from '../../respond'

/**
 * The accept-invitation product surface's simulated-mode entrypoint (Bob's lifecycle). Same 404 gate
 * as /api/auth/dev-signin, first line — this is a real product feature, but only meaningful
 * against the fake auth adapter; real mode ships Clerk's own ticket-strategy sign-up instead
 * (packages/keel/src/adapters/real/accept-invite-form.tsx).
 */
export async function POST(request: Request): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        const { inviteId, name, locale } = (await request.json()) as {
            inviteId?: string
            name?: string
            locale?: string
        }
        if (typeof inviteId !== 'string' || typeof name !== 'string') {
            return Response.json({ error: 'invalid request' }, { status: 400 })
        }
        const joined = await acceptInvite(inviteId, { name, locale })

        // Clickwrap-on-join: accepting the invitation records acceptance of the tenant's
        // current agreements, so a freshly joined user isn't immediately blocked by an access gate they
        // just implicitly agreed to. A later version bump re-arms the gate for them like everyone else.
        // NOT audited — invite acceptance is deliberately outside the audit trail (see packages/keel/src/db/audit.ts).
        // In real mode this route doesn't run: a Clerk-based join lands the new user on the interstitial
        // instead, resolved through the very same gate seam.
        const tenantId = await tenantIdForSlug(db, joined.tenantSlug)
        if (tenantId) {
            const current = await listAgreementsForTenant(db, tenantId)
            for (const agreement of current) {
                await recordAcceptance(db, {
                    tenantId,
                    agreementId: agreement.id,
                    agreementVersion: agreement.version,
                    userId: joined.id,
                    metadata: { via: 'invite' },
                })
            }
        }

        return Response.json({ ok: true })
    })
}
