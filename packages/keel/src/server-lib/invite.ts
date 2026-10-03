import { getTranslations } from 'next-intl/server'
import { analytics, auth, db, email } from '../adapters/index'
import type { Locale } from '../core/locale'
import type { Role } from '../core/roles'
import { recordAuditEvent } from '../db/audit'
import { sendTemplate } from '../email/send'
import { InviteEmail } from '../email/templates/invite-email'
import type { Membership } from '../ports/auth'
import { deferAfterResponse } from './defer'
import { notifyAdmins } from './notify'
import { makeNotifyDeps } from './notify-deps'

/**
 * Inviting someone to a team, AFTER the caller has decided it may happen: mint the invite, audit it,
 * mail the invitee their accept link, record the analytics event, and tell the team's other admins.
 *
 * Authorization, validation and the duplicate check stay with the CALLER, because they differ by
 * caller: the org route authorizes the signed-in session and answers 400/409, while a demo preset's
 * replay (./demo-presets.ts) has no session at all and was held to the same rules at build time
 * (keel/core/presets.ts `presetProblems`). What happens once an invite is allowed does not differ, so
 * it lives here once — a preset that re-implemented it would be a second invite flow, free to drift.
 */
export async function sendOrgInvite(input: {
    /** Who is inviting: named in the email, excluded from the admins' notification, and the audit actor. */
    inviter: { id: string; name: string; locale: Locale }
    tenantSlug: string
    tenantId: string
    orgId: string
    orgSlug: string
    orgName: string
    email: string
    role: Role
    /** The org's current members (the caller already fetched them for its duplicate check). */
    members: Membership[]
    /** Any absolute URL on this host; the accept link is built against its origin. */
    baseUrl: string
}): Promise<Membership> {
    const membership = await auth.createInvite({ email: input.email, role: input.role, orgSlug: input.orgSlug })

    // Audit trail: the invite is the audited mutation — a Membership was created.
    await recordAuditEvent(db, {
        tenantId: input.tenantId,
        orgId: input.orgId,
        actorUserId: input.inviter.id,
        action: 'membership.invited',
        subjectType: 'Membership',
        subjectId: membership.id,
    })

    const acceptUrl = new URL(
        `/${input.inviter.locale}/accept-invite?invite=${membership.id}`,
        input.baseUrl,
    ).toString()
    // The invitee has no account (and so no locale) yet — the inviter's locale is the best available
    // signal for the email copy (ADR-0008).
    const t = await getTranslations({ locale: input.inviter.locale, namespace: 'email' })
    // Deferred: the notification email is a post-response side effect — a slow mail provider must never
    // add latency to the invite request. Simulated mode runs it inline (deterministic + visible in
    // Simulator events); real mode sends it via Next's after().
    await deferAfterResponse('invite-email', () =>
        sendTemplate(email, {
            to: input.email,
            subject: t('inviteSubject', { org: input.orgName }),
            template: InviteEmail({
                labels: {
                    preview: t('invitePreview', { org: input.orgName }),
                    heading: t('inviteHeading', { org: input.orgName }),
                    body: t('inviteBody', { inviter: input.inviter.name, org: input.orgName, role: input.role }),
                    button: t('inviteButton'),
                    linkFallback: t('inviteLinkFallback'),
                },
                acceptUrl,
            }),
        }),
    )
    await analytics.capture('org_invite_sent', { tenant: input.tenantSlug, org: input.orgSlug, role: input.role })

    // Notification fan-out: tell the inviting team's OTHER admins that an invite went out. The invitee
    // has no account yet, so they can't hold an in-app row — the admins are the demoable recipients
    // (see the decision log). The inviter is excluded so they aren't notified of their own action.
    // After-commit, like the audit.
    await notifyAdmins(await makeNotifyDeps(), {
        members: input.members,
        tenantId: input.tenantId,
        orgId: input.orgId,
        kind: 'org.invited',
        payload: { email: input.email, role: input.role, orgName: input.orgName },
        excludeUserId: input.inviter.id,
    })

    return membership
}
