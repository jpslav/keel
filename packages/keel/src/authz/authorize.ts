import { anchorSubjectExtras, staffOrgSlug } from '@app-config/abilities'
import {
    type AbilityAction,
    type AbilityActor,
    type AbilitySubject,
    type Actor,
    type MachineActor,
    SERVICE_KEY_ISSUER,
    type SubjectType,
    defineAbilitiesFor,
} from '../core/abilities'
import type { AuthUser } from '../ports/auth'
import { ForbiddenError } from '../ports/errors'
import type { ServiceIdentity } from '../service-auth/verify'

/**
 * The server-side authorization seam. Product mutation routes call {@link authorize}
 * explicitly after they've resolved the subject's org (the id is handler-derived, so it can't be
 * pre-wrapped as middleware). A build-time scanner (authorized-mutations.test.ts) proves every
 * mutating route either calls authorize(...) or is a justified exemption.
 *
 * It judges two kinds of actor (keel/core/abilities `Actor`): a PERSON, lifted from a session by
 * {@link abilityActorFromUser} (or built by hand for a person who arrived another way — a personal API
 * token), and a MACHINE, from {@link abilityActorFromService} or {@link machineActor}. Whatever the
 * credential, the route verifies it FIRST and builds the actor from what it proved; the actor's org is
 * the credential's, never a request field.
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

/**
 * Issuers a {@link machineActor} may not claim: `service-key` is keel's own service keys, which only
 * {@link abilityActorFromService} builds (it is the issuer the framework's one machine grant names), and
 * `system` is what keel's background writers record as (`system:scheduler`, `system:webhooks`,
 * `system:inbound-email`), so a machine claiming it would be indistinguishable from them in the audit
 * trail.
 */
const RESERVED_MACHINE_ISSUERS: readonly string[] = [SERVICE_KEY_ISSUER, 'system']

/** An issuer is a short lowercase slug: it prefixes every principal id, so it may not contain `:`. */
const ISSUER = /^[a-z][a-z0-9-]*$/

/**
 * Build a MACHINE actor for a caller the APP verified — a CI identity, an integration's token. Call it
 * only with what the verifier PROVED: `id` is the machine's identity within `issuer` (a repository, a
 * client id), `activeOrgId` the org its credential is bound to. A machine gets exactly what the app's
 * `appMachineAbilityRules` grants it, and no framework power at all.
 *
 * @throws Error (a programming error, so a 500 — never a 403) on a malformed or reserved issuer, or an
 *   empty id or org.
 */
export function machineActor(input: { issuer: string; id: string; activeOrgId: string }): MachineActor {
    const { issuer, id, activeOrgId } = input
    if (!ISSUER.test(issuer)) throw new Error(`machineActor: issuer must be a lowercase slug, got "${issuer}"`)
    if (RESERVED_MACHINE_ISSUERS.includes(issuer)) throw new Error(`machineActor: issuer "${issuer}" is reserved`)
    if (id.length === 0) throw new Error('machineActor: id must not be empty')
    if (activeOrgId.length === 0) throw new Error('machineActor: activeOrgId must not be empty')
    return { kind: 'machine', issuer, principalId: `${issuer}:${id}`, activeOrgId }
}

/**
 * Lift a VERIFIED service caller (keel's per-org RS256 keys, `verifyServiceCaller`) into a machine
 * actor. The verifying key row IS the org, so the actor acts in exactly that org; its principal id is
 * `service-key:<org slug>`, which is what an audit row records for it.
 */
export function abilityActorFromService(identity: ServiceIdentity): MachineActor {
    return {
        kind: 'machine',
        issuer: SERVICE_KEY_ISSUER,
        principalId: `${SERVICE_KEY_ISSUER}:${identity.orgSlug}`,
        activeOrgId: identity.orgId,
    }
}

/**
 * Throw ForbiddenError (→ 403 via withPortErrors) unless the actor may perform the action.
 *
 * Two forms, one choke point (the build-time scan matches both):
 * - `authorize(actor, action, subject)` — any {@link Actor}: a machine, or a person who did not arrive
 *   through a session.
 * - `authorize(user, activeOrgId, action, subject)` — a signed-in person; shorthand for
 *   `authorize(abilityActorFromUser(user, activeOrgId), action, subject)`, and what every session route
 *   calls.
 */
export function authorize(actor: Actor, action: AbilityAction, subject: AbilitySubject): void
export function authorize(user: AuthUser, activeOrgId: string, action: AbilityAction, subject: AbilitySubject): void
export function authorize(
    ...args: [Actor, AbilityAction, AbilitySubject] | [AuthUser, string, AbilityAction, AbilitySubject]
): void {
    const [actor, action, subject] =
        args.length === 4 ? ([abilityActorFromUser(args[0], args[1]), args[2], args[3]] as const) : args
    if (!defineAbilitiesFor(actor).can(action, subject)) {
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
