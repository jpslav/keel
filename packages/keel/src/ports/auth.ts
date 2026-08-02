import type { Locale } from '../core/locale'
import type { Role } from '../core/roles'

export interface AuthUser {
    id: string
    name: string
    email: string
    /** Role in the ACTIVE org (the Clerk org-membership role analog). */
    role: Role
    locale: Locale
    /** Ambient site claim from the deployment/session — never user-switchable in product UI. */
    tenantSlug: string
    /** Slug of the org (product copy: "team") this session is currently acting in. */
    orgSlug: string
    /** Limited-access seam: restricted members see a reduced feature surface. */
    restricted: boolean
}

/** An org the current user belongs to; `role` is their role in THAT org (drives the OrgSwitcher). */
export interface OrgRef {
    slug: string
    name: string
    role: Role
}

export interface Membership {
    /** For an active member, the USER's id (same namespace as AuthUser.id — consumers compare the
     *  two); for a pending invitation, the invitation's id. */
    id: string
    name: string | null
    email: string
    role: Role
    status: 'active' | 'invited'
}

export interface ProfileUpdate {
    name?: string
    locale?: Locale
}

export interface InviteInput {
    email: string
    role: Role
    orgSlug: string
}

/**
 * Server-side auth port (ADR-0003). Sized to what the app needs — never to Clerk's API.
 * The custom Mantine auth UI is the ONLY auth UI; both adapters sit behind it.
 */
export interface AuthPort {
    getCurrentUser(): Promise<AuthUser | null>
    /** @throws AuthRequiredError when signed out */
    requireUser(): Promise<AuthUser>
    /** @throws AuthRequiredError | ForbiddenError — roles are evaluated in the ACTIVE org */
    requireRole(...roles: Role[]): Promise<AuthUser>
    /** App-relative path (locale-less) the UI should send signed-out users to. */
    signInPath(returnTo?: string): string
    signOut(): Promise<void>
    updateProfile(update: ProfileUpdate): Promise<AuthUser>
    listMembers(orgSlug: string): Promise<Membership[]>
    /** Records the invitation (per-org); sending the notification email is the caller's job (email port). */
    createInvite(invite: InviteInput): Promise<Membership>
    /** Orgs the current user belongs to (drives the OrgSwitcher). */
    listMyOrgs(): Promise<OrgRef[]>
    /** @throws ForbiddenError when the user has no membership in that org */
    setActiveOrg(orgSlug: string): Promise<void>
}
