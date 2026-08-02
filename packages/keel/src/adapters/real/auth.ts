import { auth, clerkClient, currentUser } from '@clerk/nextjs/server'
import { DEFAULT_LOCALE, LOCALES, type Locale } from '../../core/locale'
import { isRole, type Role } from '../../core/roles'
import type { AuthPort, AuthUser, InviteInput, Membership, OrgRef, ProfileUpdate } from '../../ports/auth'
import { AuthRequiredError, ForbiddenError } from '../../ports/errors'

/**
 * Clerk headless adapter (ADR-0003). Clerk organizations ARE our orgs
 * (product copy: "teams"); our org slug === Clerk org slug (no mapping layer). The tenant (site) is
 * ambient and lives in user publicMetadata.tenantSlug — one Clerk instance per tenant in prod, so
 * every org a user sees belongs to their tenant. The ACTIVE org rides in unsafeMetadata.currentOrgSlug,
 * and the request-time role comes from that org membership's publicMetadata.role (role is per-org).
 *
 * AUTHORED — CUTOVER (`auth-dev`): typechecked against @clerk/nextjs, never run against a real
 * Clerk instance. Verify the full port contract suite against the dev instance at cutover.
 * Cutover perf checkpoint: getCurrentUser now issues an extra getOrganizationMembershipList per
 * request to resolve the active-org role — measure and cache if hot.
 */

interface AppPublicMetadata {
    role?: string
    locale?: string
    restricted?: boolean
    tenantSlug?: string
}

function roleFrom(metadata: unknown, fallback: Role): Role {
    const role = (metadata as AppPublicMetadata)?.role
    return role && isRole(role) ? role : fallback
}

async function organizationIdForSlug(slug: string): Promise<string> {
    const client = await clerkClient()
    const org = await client.organizations.getOrganization({ slug })
    return org.id
}

export const realAuth: AuthPort = {
    async getCurrentUser(): Promise<AuthUser | null> {
        const { userId } = await auth()
        if (!userId) return null
        const user = await currentUser()
        if (!user) return null
        const metadata = (user.publicMetadata ?? {}) as AppPublicMetadata
        const locale = LOCALES.includes(metadata.locale as Locale) ? (metadata.locale as Locale) : DEFAULT_LOCALE

        // Resolve the active org membership: the remembered currentOrgSlug if still a membership,
        // else the first one. Role comes from that membership (per-org), not the user object.
        const client = await clerkClient()
        const memberships = await client.users.getOrganizationMembershipList({ userId, limit: 100 })
        const currentOrgSlug = (user.unsafeMetadata as { currentOrgSlug?: string })?.currentOrgSlug
        const active =
            memberships.data.find((m) => (m.organization.slug ?? m.organization.id) === currentOrgSlug) ??
            memberships.data[0]

        return {
            id: userId,
            name: user.fullName ?? user.primaryEmailAddress?.emailAddress ?? userId,
            email: user.primaryEmailAddress?.emailAddress ?? '',
            role: roleFrom(active?.publicMetadata, 'guest'),
            locale,
            // Ambient site claim — never the active org's business.
            tenantSlug: metadata.tenantSlug ?? '',
            orgSlug: active ? (active.organization.slug ?? active.organization.id) : '',
            restricted: metadata.restricted ?? false,
        }
    },

    async requireUser(): Promise<AuthUser> {
        const user = await this.getCurrentUser()
        if (!user) throw new AuthRequiredError()
        return user
    },

    async requireRole(...roles: Role[]): Promise<AuthUser> {
        const user = await this.requireUser()
        if (!roles.includes(user.role)) throw new ForbiddenError(`requires one of: ${roles.join(', ')}`)
        return user
    },

    signInPath(returnTo?: string): string {
        return returnTo ? `/signin?returnTo=${encodeURIComponent(returnTo)}` : '/signin'
    },

    async signOut(): Promise<void> {
        // Server-side revocation; the client additionally calls Clerk's signOut for local state.
        const { sessionId } = await auth()
        if (!sessionId) return
        const client = await clerkClient()
        await client.sessions.revokeSession(sessionId)
    },

    async updateProfile(update: ProfileUpdate): Promise<AuthUser> {
        const { userId } = await auth()
        if (!userId) throw new AuthRequiredError()
        const client = await clerkClient()
        if (update.name !== undefined) {
            const [firstName, ...rest] = update.name.split(' ')
            await client.users.updateUser(userId, { firstName, lastName: rest.join(' ') })
        }
        if (update.locale !== undefined) {
            // Same guard the fake adapter enforces — the two adapters must reject alike.
            if (!LOCALES.includes(update.locale)) throw new ForbiddenError('unknown locale')
            await client.users.updateUserMetadata(userId, { publicMetadata: { locale: update.locale } })
        }
        const user = await this.getCurrentUser()
        if (!user) throw new AuthRequiredError()
        return user
    },

    async listMembers(orgSlug: string): Promise<Membership[]> {
        const client = await clerkClient()
        const organizationId = await organizationIdForSlug(orgSlug)
        const [members, invitations] = await Promise.all([
            client.organizations.getOrganizationMembershipList({ organizationId, limit: 100 }),
            client.organizations.getOrganizationInvitationList({ organizationId, status: ['pending'], limit: 100 }),
        ])
        const active: Membership[] = members.data.map((m) => {
            const data = m.publicUserData
            return {
                // The USER id, never the membership resource id: Membership.id must share
                // AuthUser.id's namespace (notify exclusion, notification recipients, assignee ids
                // all compare the two) — the fake adapter's person ids already do.
                id: data?.userId ?? m.id,
                name: data ? `${data.firstName ?? ''} ${data.lastName ?? ''}`.trim() || null : null,
                email: data?.identifier ?? '',
                role: roleFrom(m.publicMetadata, 'member'),
                status: 'active' as const,
            }
        })
        const invited: Membership[] = invitations.data.map((i) => ({
            id: i.id,
            name: null,
            email: i.emailAddress,
            role: roleFrom(i.publicMetadata, 'member'),
            status: 'invited' as const,
        }))
        return [...active, ...invited]
    },

    async createInvite(invite: InviteInput): Promise<Membership> {
        const { userId } = await auth()
        if (!userId) throw new AuthRequiredError()
        const client = await clerkClient()
        const organizationId = await organizationIdForSlug(invite.orgSlug)
        const created = await client.organizations.createOrganizationInvitation({
            organizationId,
            emailAddress: invite.email,
            inviterUserId: userId,
            role: 'org:member',
            publicMetadata: { role: invite.role },
        })
        return { id: created.id, name: null, email: created.emailAddress, role: invite.role, status: 'invited' }
    },

    async listMyOrgs(): Promise<OrgRef[]> {
        const { userId } = await auth()
        if (!userId) return []
        const client = await clerkClient()
        const memberships = await client.users.getOrganizationMembershipList({ userId, limit: 100 })
        return memberships.data.map((m) => ({
            slug: m.organization.slug ?? m.organization.id,
            name: m.organization.name,
            role: roleFrom(m.publicMetadata, 'member'),
        }))
    },

    async setActiveOrg(orgSlug: string): Promise<void> {
        const { userId } = await auth()
        if (!userId) throw new AuthRequiredError()
        const mine = await this.listMyOrgs()
        if (!mine.some((o) => o.slug === orgSlug)) throw new ForbiddenError(`no membership in org: ${orgSlug}`)
        const client = await clerkClient()
        await client.users.updateUserMetadata(userId, { unsafeMetadata: { currentOrgSlug: orgSlug } })
    },
}
