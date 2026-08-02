import { anchorSubjectExtras, staffOrgSlug } from '@app-config/abilities'
import {
    type AbilityAction,
    type AbilityActor,
    type AbilitySubject,
    type SubjectType,
    defineAbilitiesFor,
} from '../core/abilities'
import type { AuthUser } from '../ports/auth'
import { ForbiddenError } from '../ports/errors'

/**
 * The server-side authorization seam. Product mutation routes call {@link authorize}
 * explicitly after they've resolved the subject's org (the id is handler-derived, so it can't be
 * pre-wrapped as middleware). A build-time scanner (authorized-mutations.test.ts) proves every
 * mutating route either calls authorize(...) or is a justified exemption.
 */

/**
 * Lift an AuthUser into the pure ability actor. `manageAll` is derived from the ACTIVE org:
 * acting AS the staff org (`user.orgSlug === staffOrgSlug`) is what wields the cross-org manage-all
 * power — a clean, explicit activation with no per-request membership-list lookup, mirroring how every
 * other power in the model is anchored to the active org. A staff-org member acting in a NON-staff org
 * (if they had another membership) would NOT have manageAll — activation is by wielding, not by mere
 * membership. Reads `user.orgSlug` (the active org's slug) directly, so it holds whether the caller
 * passes a uuid activeOrgId (routes) or the slug anchor (canInActiveOrg). NEVER crosses tenants:
 * manageAll only short-circuits the per-subject rules, which are already tenant-bounded, and every
 * product query still runs inside withTenant — see the decision log.
 */
export function abilityActorFromUser(user: AuthUser, activeOrgId: string): AbilityActor {
    return {
        userId: user.id,
        role: user.role,
        restricted: user.restricted,
        activeOrgId,
        manageAll: user.orgSlug === staffOrgSlug,
    }
}

/** Throw ForbiddenError (→ 403 via withPortErrors) unless the user may perform the action. */
export function authorize(user: AuthUser, activeOrgId: string, action: AbilityAction, subject: AbilitySubject): void {
    const ability = defineAbilitiesFor(abilityActorFromUser(user, activeOrgId))
    if (!ability.can(action, subject)) {
        throw new ForbiddenError(`cannot ${action} ${subject.type}`)
    }
}

/**
 * Non-throwing UI/read gate. Anchors BOTH the actor's active org and the subject's org to the
 * session's active-org token, so create/manage checks need no uuid lookup: sameOrg only compares
 * the two for equality, so any stable per-session token (the org slug) satisfies it. Use this to
 * reflect ability in the UI (e.g. disable the app's create form for restricted members).
 *
 * For a TWO-SIDED subject — one whose seam-registered fields name a requester org and a responder org
 * rather than a single `orgId` — the same anchor stands in for both sides, so a create-gate reads as
 * "am I the requester" and an update-gate as "am I the responder" against my own active org — enough
 * to decide whether to render the create form / the accept-reject controls. This is a UI gate ONLY;
 * server enforcement (authorize) uses the request row's REAL org ids, never this slug anchor.
 */
export function canInActiveOrg(user: AuthUser, action: AbilityAction, type: SubjectType): boolean {
    const anchor = user.orgSlug
    const ability = defineAbilitiesFor(abilityActorFromUser(user, anchor))
    return ability.can(action, {
        type,
        orgId: anchor,
        ownerId: user.id,
        // App-subject anchor extras (the two-sided request sides) come from the seam so this framework
        // gate never hard-codes app-subject fields (ADR-0012).
        ...anchorSubjectExtras(anchor),
    })
}
