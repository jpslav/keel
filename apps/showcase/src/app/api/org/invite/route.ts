import { getTranslations } from 'next-intl/server'
import { analytics, auth, db, email } from 'keel/adapters/index'
import { authorize } from 'keel/authz/authorize'
import { recordAuditEvent } from 'keel/db/audit'
import { ORG_ASSIGNABLE_ROLES, isRole, type Role } from 'keel/core/roles'
import { findOrg } from '@app/seed'
import { InviteEmail } from 'keel/email/templates/invite-email'
import { sendTemplate } from 'keel/email/send'
import { deferAfterResponse } from 'keel/server-lib/defer'
import { notifyAdmins } from 'keel/server-lib/notify'
import { makeNotifyDeps } from 'keel/server-lib/notify-deps'
import { resolveOrgContext } from '../../org-context'
import { withPortErrors } from '../../respond'

export async function POST(request: Request): Promise<Response> {
    return withPortErrors(async () => {
        const user = await auth.requireUser()
        // Authorization choke point: only org managers may create memberships. Anchored to
        // the active org's slug (no uuid lookup needed — Membership.create only checks managership +
        // sameOrg). Replaces the coarse requireRole(...ORG_MANAGER_ROLES) with the ability model.
        authorize(user, user.orgSlug, 'create', { type: 'Membership', orgId: user.orgSlug })
        // Resolve the active org's real ids for the audit write (the authorize above only needs the
        // slug anchor; Membership.create checks managership + sameOrg, no uuid lookup).
        const resolved = await resolveOrgContext(user)
        if (resolved instanceof Response) return resolved
        const { tenantId, orgId } = resolved
        const body = (await request.json()) as { email: string; role: string }
        // Server-side allowlist, independent of what the UI offers: managers may never grant admin.
        if (!isRole(body.role) || !ORG_ASSIGNABLE_ROLES.includes(body.role as Role)) {
            return Response.json({ error: 'role not assignable' }, { status: 400 })
        }
        // Same shape check the form runs — the API must not trust the UI (mirrors the role
        // allowlist above).
        const inviteEmail = typeof body.email === 'string' ? body.email.trim() : ''
        if (!/.+@.+\..+/.test(inviteEmail)) {
            return Response.json({ error: 'invalid email' }, { status: 400 })
        }
        // One row per address: a second invite (or an invite to an existing member) would create
        // confusing duplicate people sharing one inbox in the People.
        const existing = await auth.listMembers(user.orgSlug)
        if (existing.some((member) => member.email.toLowerCase() === inviteEmail.toLowerCase())) {
            return Response.json({ error: 'duplicate' }, { status: 409 })
        }

        const membership = await auth.createInvite({
            email: inviteEmail,
            role: body.role,
            orgSlug: user.orgSlug,
        })

        // Audit trail: the invite is the audited mutation — a Membership was created.
        await recordAuditEvent(db, {
            tenantId,
            orgId,
            actorUserId: user.id,
            action: 'membership.invited',
            subjectType: 'Membership',
            subjectId: membership.id,
        })

        const orgName = findOrg(user.orgSlug)?.name ?? user.orgSlug
        const acceptUrl = new URL(`/${user.locale}/accept-invite?invite=${membership.id}`, request.url).toString()
        // The invitee has no account (and so no locale) yet — the inviter's locale is the best
        // available signal for the email copy (ADR-0008).
        const t = await getTranslations({ locale: user.locale, namespace: 'email' })
        // Deferred: the notification email is a post-response side effect — a
        // slow mail provider must never add latency to the invite request. Simulated mode runs it inline
        // (deterministic + visible in Simulator events); real mode sends it via Next's after().
        await deferAfterResponse('invite-email', () =>
            sendTemplate(email, {
                to: inviteEmail,
                subject: t('inviteSubject', { org: orgName }),
                template: InviteEmail({
                    labels: {
                        preview: t('invitePreview', { org: orgName }),
                        heading: t('inviteHeading', { org: orgName }),
                        body: t('inviteBody', { inviter: user.name, org: orgName, role: body.role }),
                        button: t('inviteButton'),
                        linkFallback: t('inviteLinkFallback'),
                    },
                    acceptUrl,
                }),
            }),
        )
        await analytics.capture('org_invite_sent', { tenant: user.tenantSlug, org: user.orgSlug, role: body.role })

        // Notification fan-out: tell the inviting team's OTHER admins that an invite went out.
        // The invitee has no account yet, so they can't hold an in-app row — the admins are the demoable
        // recipients (see the decision log). Reuses the members already fetched for the dup check; the
        // inviter is excluded so they aren't notified of their own action. After-commit, like the audit.
        await notifyAdmins(await makeNotifyDeps(), {
            members: existing,
            tenantId,
            orgId,
            kind: 'org.invited',
            payload: { email: inviteEmail, role: body.role, orgName },
            excludeUserId: user.id,
        })

        return Response.json({ membership })
    })
}
