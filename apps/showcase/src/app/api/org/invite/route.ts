import { auth } from 'keel/adapters/index'
import { authorize } from 'keel/authz/authorize'
import { isAssignableRole } from 'keel/core/roles'
import { findOrg } from '@app/seed'
import { sendOrgInvite } from 'keel/server-lib/invite'
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
        if (!isAssignableRole(body.role)) {
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

        // Everything after the decision to invite is the framework's, shared with the demo-preset replay.
        const membership = await sendOrgInvite({
            inviter: user,
            tenantSlug: user.tenantSlug,
            tenantId,
            orgId,
            orgSlug: user.orgSlug,
            orgName: findOrg(user.orgSlug)?.name ?? user.orgSlug,
            email: inviteEmail,
            role: body.role,
            members: existing,
            baseUrl: request.url,
        })

        return Response.json({ membership })
    })
}
