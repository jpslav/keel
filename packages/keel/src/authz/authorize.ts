import { anchorSubjectExtras, staffOrgSlug } from '@app-config/abilities'
import type { AppMachineCredentialKind } from '@app-config/abilities'
import {
    type AbilityAction,
    type AbilityActor,
    type AbilitySubject,
    type Actor,
    type MachineActor,
    type PersonCredentialKind,
    type SubjectType,
    defineAbilitiesFor,
} from '../core/abilities'
import type { AuthPort, AuthUser } from '../ports/auth'
import { ForbiddenError } from '../ports/errors'
import type { ServiceIdentity } from '../service-auth/verify'

/**
 * The server-side authorization seam. Product mutation routes call {@link authorize}
 * explicitly after they've resolved the subject's org (the id is handler-derived, so it can't be
 * pre-wrapped as middleware). A build-time scanner (authorized-mutations.test.ts) proves every
 * mutating route either calls authorize(...) or is a justified exemption.
 *
 * It judges two kinds of actor (keel/core/abilities `Actor`), each carrying the credential it came with:
 * - a PERSON, lifted from a session by {@link abilityActorFromUser}, or from another credential a person
 *   holds (an inbound email, a personal API token) by {@link abilityActorFromCredential};
 * - a MACHINE, from {@link abilityActorFromService} or {@link machineActor}.
 * Whatever the credential, the route verifies it FIRST and builds the actor from what it proved. The
 * actor's org is the credential's, never a request field.
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
        kind: 'person',
        credential: { kind: 'session', id: null },
        userId: user.id,
        role: user.role,
        restricted: user.restricted,
        activeOrgId,
        manageAll: user.orgSlug === staffOrgSlug,
    }
}

/**
 * Build the PERSON actor for someone who reached the app with a credential other than a session: an
 * inbound email from their address, a personal API token they minted. The caller's verifier has
 * already established WHO (`userId`) and WHERE (`org`, the org the credential is bound to), and only
 * as firmly as that credential can: a token row is cryptographic, while an email sender rests on the
 * mail provider's SPF/DKIM checks (the residual the inbound-email handlers record). This reads the
 * person's standing there through the auth port. It takes no role, so a role can be neither cached in
 * the credential nor derived from it, and it reads on every call, so a person who has been removed or
 * demoted is judged by what they are now.
 *
 * `org.id` and `org.slug` must come from the SAME organizations row: the standing is read by slug, the
 * way the auth port names orgs, and applied to the id every sameOrg check compares. Resolve one from the
 * other (`orgIdForSlug`) rather than taking either from the request.
 *
 * Returns null when the person is no longer an active member of that org: their credential is dead. A
 * route that uses this should answer 401 (throw `AuthRequiredError`); the inbound-email handlers, its
 * only callers in this repo, file the message 'unmatched'. The actor never wields `manageAll`, even acting in the staff org; that power
 * belongs to a session, and keel/core/abilities enforces it whatever this field says.
 *
 * @throws Error (a programming error, never a 403) when handed a `session` credential: a session's
 *   person comes from {@link abilityActorFromUser}, and letting one through here would let any caller
 *   claim the session-only rules.
 */
export async function abilityActorFromCredential(
    auth: Pick<AuthPort, 'getMember'>,
    input: {
        userId: string
        org: { id: string; slug: string }
        credential: { kind: Exclude<PersonCredentialKind, 'session'>; id: string }
    },
): Promise<AbilityActor | null> {
    // The type excludes `session`, but an app that registered it as one of its own kinds, or a cast,
    // would not be stopped by the type.
    const kind: string = input.credential.kind
    if (kind === 'session') throw new Error('abilityActorFromCredential: a session is not a credential this builds')
    const standing = await auth.getMember(input.org.slug, input.userId)
    if (!standing) return null
    return {
        kind: 'person',
        credential: input.credential,
        userId: input.userId,
        role: standing.role,
        restricted: standing.restricted,
        activeOrgId: input.org.id,
        manageAll: false,
    }
}

/**
 * Kinds a {@link machineActor} may not claim, checked at run time because the composed kind union cannot
 * stop an app registering one. `service-key` is keel's own service keys, which only
 * {@link abilityActorFromService} builds; it is the kind the framework's one machine grant names.
 * `session` and `inbound-email` are PERSON credentials. `system` is what keel's background writers
 * record as (`system:scheduler`, `system:webhooks`, `system:inbound-email`), so a machine claiming it
 * would be indistinguishable from them in the audit trail.
 */
const RESERVED_MACHINE_KINDS: readonly string[] = ['service-key', 'session', 'inbound-email', 'system']

/** A credential kind is a short lowercase slug: it prefixes every principal id, so it may not contain `:`. */
const KIND = /^[a-z][a-z0-9-]*$/

/**
 * Build a MACHINE actor for a caller the APP verified, such as a CI identity or an integration's token.
 * Call it only with what the verifier PROVED. `kind` is one of the app's machine credential kinds
 * (`AppMachineCredentialKind` on the seam). `id` is the machine's identity within that kind (a
 * repository, a client id). `credentialId` names the credential it presented this time (a workflow run,
 * a key id), never a secret. `activeOrgId` is the org that credential is bound to. A machine gets
 * exactly what the app's `appMachineAbilityRules` grants it, and no framework power at all.
 *
 * Neither keel app registers a machine kind of its own, so only keel's own tests call this today
 * (`authorize.test.ts`, with the fixture seam's `fixture-intake` kind). Its intended first consumer is
 * an adopter's CI identity (a GitHub OIDC token from a listed repository; docs/decision-log.md,
 * 2026-11-16). The run-time checks below are what a hand-written `MachineActor` literal would not
 * give it.
 *
 * @throws Error (a programming error, so a 500 — never a 403) on a malformed or reserved kind, or an
 *   empty id or org.
 */
export function machineActor(input: {
    kind: AppMachineCredentialKind
    id: string
    credentialId?: string
    activeOrgId: string
}): MachineActor {
    const { kind, id, activeOrgId } = input
    const name: string = kind
    if (!KIND.test(name)) throw new Error(`machineActor: kind must be a lowercase slug, got "${name}"`)
    if (RESERVED_MACHINE_KINDS.includes(name)) throw new Error(`machineActor: kind "${name}" is reserved`)
    if (id.length === 0) throw new Error('machineActor: id must not be empty')
    if (activeOrgId.length === 0) throw new Error('machineActor: activeOrgId must not be empty')
    return {
        kind: 'machine',
        credential: { kind, id: input.credentialId ?? null },
        principalId: `${name}:${id}`,
        activeOrgId,
    }
}

/**
 * Lift a VERIFIED service caller (keel's per-org RS256 keys, `verifyServiceCaller`) into a machine
 * actor. The verifying key row IS the org, so the actor acts in exactly that org. Its principal id is
 * `service-key:<org slug>`, which is what an audit row records for it, and its credential names the
 * key that verified the call.
 */
export function abilityActorFromService(identity: ServiceIdentity): MachineActor {
    return {
        kind: 'machine',
        credential: { kind: 'service-key', id: identity.keyId },
        principalId: `service-key:${identity.orgSlug}`,
        activeOrgId: identity.orgId,
    }
}

/**
 * Throw ForbiddenError (→ 403 via withPortErrors) unless the actor may perform the action.
 *
 * Two forms, one choke point (the build-time scan matches both):
 * - `authorize(actor, action, subject)` — any {@link Actor}: a machine, or a person who arrived with
 *   another credential (from {@link abilityActorFromCredential}).
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
