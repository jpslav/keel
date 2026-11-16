export const ROLES = ['admin', 'staff', 'member', 'guest', 'restricted'] as const
export type Role = (typeof ROLES)[number]

// The designated staff/operator org slug is an app/deployment choice, so it lives on the
// seam as `staffOrgSlug` (src/app-config/abilities.ts) — NOT here. DISAMBIGUATION: the operator ORG is
// NOT the rank-ladder role `'staff'` below; the role is an org-manager RANK, the org is the operator
// org whose active membership activates cross-org manage-all. See the seam for the doctrine + slug.

/**
 * Roles allowed to manage an organization (member list, invites). Module-private: the ability layer
 * (packages/keel/src/core/abilities.ts) and callers consume the `canManageOrg` predicate below, not the raw list —
 * the last external use (org/invite's requireRole) is now authorize('Membership').
 */
const ORG_MANAGER_ROLES: readonly Role[] = ['admin', 'staff']

/**
 * Roles an org manager may GRANT via invite. Excludes admin — managers must never mint a role
 * above their own; the API never accepts a role the caller cannot grant.
 */
export const ORG_ASSIGNABLE_ROLES: readonly Role[] = ['staff', 'member', 'guest', 'restricted']

export function isRole(value: string): value is Role {
    return (ROLES as readonly string[]).includes(value)
}

/**
 * The invite-path check: is `value` a role an org manager may grant? Narrower than `isRole`, which
 * accepts `'admin'`. One predicate shared by the real invite route and the static demo's invite twin,
 * so the two cannot disagree about who may be minted.
 */
export function isAssignableRole(value: string): value is Role {
    return (ORG_ASSIGNABLE_ROLES as readonly string[]).includes(value)
}

export function canManageOrg(role: Role): boolean {
    return ORG_MANAGER_ROLES.includes(role)
}
