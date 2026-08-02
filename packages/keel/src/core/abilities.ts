import { appAbilityRules, type AppSubjectFields, type AppSubjectType } from '@app-config/abilities'
import { canManageOrg, type Role } from './roles'

/**
 * The authorization model. PURE TypeScript — imports only ./roles and the app-config seam
 * (ADR-0006/-0012, lint-enforced): this file is the single source of truth for "who may do what" for
 * the FRAMEWORK's base subjects, shared verbatim by the server seam (packages/keel/src/authz/authorize.ts) and the
 * static demo twin. The public shape is deliberately CASL-like (can/cannot over action+subject) so the
 * hand-rolled rule table can be swapped for @casl/ability later without touching callers. Deny by
 * default: every path that isn't explicitly allowed is denied.
 *
 * FRAMEWORK/APP LINE (ADR-0012): the base union + switch below are framework; the APP's own subjects
 * register through the seam — the `default:` case delegates to appAbilityRules,
 * and the composed SubjectType is BaseSubjectType | AppSubjectType. An adopter extends abilities by
 * editing src/app-config/abilities.ts, never this file's base union or switch.
 */

export type AbilityAction = 'create' | 'read' | 'update' | 'delete' | 'manage'

/**
 * The framework's base subjects. 'JobSchedule', 'WebhookDelivery' and 'InboundEmail' have no per-actor
 * ability rules (all are system-managed — advanced by the cross-tenant scheduler / drained by the
 * webhook system / filed by the inbound-email intake, never mutated through a per-user route); each
 * exists as a SubjectType only so the audit trail can name it as a subject, and the switch denies them.
 * 'WebhookEndpoint' DOES have rules (the org-admin endpoint card). 'Notification'/
 * 'NotificationPref' and 'AgreementAcceptance' are SELF-ONLY, like 'User'.
 */
type BaseSubjectType =
    | 'Job'
    | 'Membership'
    | 'Org'
    | 'User'
    | 'JobSchedule'
    | 'WebhookEndpoint'
    | 'WebhookDelivery'
    | 'InboundEmail'
    | 'Notification'
    | 'NotificationPref'
    | 'AgreementAcceptance'

/** The full subject union: framework base + the app's registered subjects (src/app-config/abilities.ts). */
export type SubjectType = BaseSubjectType | AppSubjectType

export interface AbilitySubject extends AppSubjectFields {
    type: SubjectType
    /** The org the subject lives in. `null`/absent means "not org-scoped" and never satisfies sameOrg. */
    orgId?: string | null
    /** Owner of the subject, for self-only rules (User.update). */
    ownerId?: string
}

export interface AbilityActor {
    userId: string
    /** Role in the ACTIVE org (mirrors AuthUser.role). */
    role: Role
    /** Limited-access seam: restricted members have a reduced feature surface (auth port). */
    restricted: boolean
    /** The org this actor is currently acting in — the anchor for every sameOrg check. */
    activeOrgId: string
    /**
     * The staff-org superpower, and it is LIVE: `abilityActorFromUser` (../authz/authorize.ts)
     * sets it when the actor is ACTING AS the app's designated operator org (`staffOrgSlug` on the
     * ADR-0012 seam). True short-circuits every per-subject rule below.
     * It never crosses tenants: the rules it skips are already tenant-bounded, and every product query
     * still runs inside withTenant (ADR-0004).
     */
    manageAll: boolean
}

export interface Ability {
    can(action: AbilityAction, subject: AbilitySubject): boolean
    cannot(action: AbilityAction, subject: AbilitySubject): boolean
}

/**
 * Compile the rule table for one actor. The framework rules (deny by default):
 * - manageAll → allow everything (held by a member acting AS the app's operator org; see above).
 * - Job:        read = sameOrg;  create              = !restricted && sameOrg.
 * - Membership: read = sameOrg;  create|manage        = canManageOrg && sameOrg.
 * - Org:        read = sameOrg;  update|manage         = canManageOrg && sameOrg.
 * - User:       update = self only (subject.ownerId === actor.userId).
 * - AgreementAcceptance: create|read = self only (subject.ownerId === actor.userId) — accept for myself.
 * - Notification / NotificationPref: self only (subject.ownerId === actor.userId).
 * - WebhookEndpoint: read = sameOrg; create|update|delete = canManageOrg && sameOrg (org-admin only).
 * - JobSchedule / WebhookDelivery / InboundEmail: system-managed, no rules (denied).
 * App-registered subjects are delegated to appAbilityRules via `default:`.
 */
export function defineAbilitiesFor(actor: AbilityActor): Ability {
    // Same org iff the subject is org-scoped AND its org is the one the actor is acting in.
    const sameOrg = (subject: AbilitySubject): boolean => subject.orgId != null && subject.orgId === actor.activeOrgId

    function can(action: AbilityAction, subject: AbilitySubject): boolean {
        // The staff-org superpower. manageAll precedes
        // the restricted checks: a restricted staff-org member would gain full authoring. Staff-org
        // membership is assumed non-restricted (nothing enforces it); if a restricted operator ever
        // becomes a real configuration, gate authoring verbs here first.
        if (actor.manageAll) return true

        switch (subject.type) {
            case 'Job':
                if (action === 'read') return sameOrg(subject)
                if (action === 'create') return !actor.restricted && sameOrg(subject)
                return false
            case 'Membership':
                if (action === 'read') return sameOrg(subject)
                if (action === 'create' || action === 'manage') return canManageOrg(actor.role) && sameOrg(subject)
                return false
            case 'Org':
                if (action === 'read') return sameOrg(subject)
                if (action === 'update' || action === 'manage') return canManageOrg(actor.role) && sameOrg(subject)
                return false
            case 'User':
                if (action === 'update') return subject.ownerId === actor.userId
                return false
            case 'Notification':
                // Self-only (like User): read/mark-read only your OWN notifications. The route ALSO
                // filters by recipient_user_id (the rls-independent recipient guard) — belt and braces.
                if (action === 'read' || action === 'update') return subject.ownerId === actor.userId
                return false
            case 'NotificationPref':
                // Self-only: a user manages ONLY their own preferences. read/update/create/manage all
                // require ownership; the route always uses the session's user id, never a client one.
                if (action === 'read' || action === 'update' || action === 'create' || action === 'manage') {
                    return subject.ownerId === actor.userId
                }
                return false
            case 'AgreementAcceptance':
                // Self-only (like User/Notification): a user may record/read only THEIR OWN acceptance.
                // The route always uses the session's user id as ownerId, never a client-supplied one.
                if (action === 'create' || action === 'read') return subject.ownerId === actor.userId
                return false
            case 'WebhookEndpoint':
                // Registering/managing an egress endpoint is an administrative act, gated like Org.
                if (action === 'read') return sameOrg(subject)
                if (action === 'create' || action === 'update' || action === 'delete') {
                    return canManageOrg(actor.role) && sameOrg(subject)
                }
                return false
            case 'JobSchedule':
            case 'WebhookDelivery':
            case 'InboundEmail':
                // System-managed subjects: no per-actor rule, denied (they exist only to be named in
                // the audit trail). See the BaseSubjectType note above.
                return false
            default:
                // App subjects register through the seam (src/app-config/abilities.ts). Deny by default:
                // appAbilityRules returns false for anything it does not explicitly allow.
                return appAbilityRules(actor, action, subject, { sameOrg })
        }
    }

    return {
        can,
        cannot: (action, subject) => !can(action, subject),
    }
}
