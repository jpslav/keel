import { defineAbilitiesFor } from 'keel/core/abilities'
import { recordAuditEvent } from 'keel/db/audit'
import type { InboundContext, InboundHandlerResult } from 'keel/inbound-email/handlers'
import { insertDocket } from './dockets'

/**
 * The fixture's ONE inbound-email handler, registered under the slug `support` — so the recipient
 * `<org-slug>+support@<domain>` opens a docket. `inbound-email/intake.test.ts` drives the framework
 * intake through it, which is why the slug is fixed rather than arbitrary.
 *
 * SENDER MATCHING + POSTURE (the same closed posture the template teaches): the sender's address is
 * matched against the org's ACTIVE members via the auth port, and the matched member must pass the
 * SAME ability check a product route would enforce (`can('create', Docket)`) — so a `restricted`
 * member whom the ability model denies in the UI is refused here too. An unmatched or unauthorized
 * sender does not open a docket; the message is filed 'unmatched'.
 */
export const supportHandler = async (ctx: InboundContext): Promise<InboundHandlerResult> => {
    const members = await ctx.auth.listMembers(ctx.orgSlug)
    const sender = members.find((m) => m.status === 'active' && m.email.toLowerCase() === ctx.fromEmail)
    if (!sender) {
        return { status: 'unmatched', reason: `sender ${ctx.fromEmail} is not a member of ${ctx.orgSlug}` }
    }

    const ability = defineAbilitiesFor({
        userId: sender.id,
        role: sender.role,
        restricted: sender.role === 'restricted',
        activeOrgId: ctx.orgId,
        manageAll: false,
    })
    if (!ability.can('create', { type: 'Docket', orgId: ctx.orgId })) {
        return { status: 'unmatched', reason: `sender ${ctx.fromEmail} may not open dockets in ${ctx.orgSlug}` }
    }

    const label = ctx.subject.trim()
    const body = ctx.bodyText.trim()
    if (!label && !body) return { status: 'unmatched', reason: 'empty email (no subject or body)' }

    const docket = await insertDocket(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: ctx.orgId,
        label: label || body.slice(0, 80),
        body: body || label,
        createdByUserId: sender.id,
    })
    await recordAuditEvent(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: ctx.orgId,
        actorUserId: sender.id,
        action: 'docket.created',
        subjectType: 'Docket',
        subjectId: docket.id,
    })
    return { status: 'handled', actorUserId: sender.id }
}
