import {
    appAbilityRules,
    appMachineAbilityRules,
    type AppSubjectFields,
    type AppSubjectType,
} from '@app-config/abilities'
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
 *
 * TWO KINDS OF ACTOR. A PERSON ({@link AbilityActor}) — signed in, or holding a credential a person was
 * issued — is judged by the rules below. A MACHINE ({@link MachineActor}) — a service key, a CI identity —
 * is judged by a SEPARATE, deny-by-default table: the framework's {@link frameworkMachineRules} for base
 * subjects and the app's `appMachineAbilityRules` for its own. A machine has no role, no `restricted`
 * flag and no `manageAll`, so it can never reach a rule written for people (ADR-0012 addendum,
 * 2026-11-16).
 */

export type AbilityAction = 'create' | 'read' | 'update' | 'delete' | 'manage'

/**
 * The framework's base subjects. 'JobSchedule', 'WebhookDelivery' and 'InboundEmail' have no per-actor
 * ability rules (all are system-managed — advanced by the cross-tenant scheduler / drained by the
 * webhook system / filed by the inbound-email intake, never mutated through a per-user route); each
 * exists as a SubjectType only so the audit trail can name it as a subject, and the switch denies them.
 * 'WebhookEndpoint' DOES have rules (the org-admin endpoint card). 'Notification'/
 * 'NotificationPref' and 'AgreementAcceptance' are SELF-ONLY, like 'User'. A new base subject must also
 * say what a MACHINE may do with it: {@link frameworkMachineRules} is keyed by this union, so leaving it
 * out fails the typecheck.
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

/**
 * A PERSON acting in one org: built from a session by `abilityActorFromUser` (../authz/authorize.ts),
 * or by hand for a person who reached the app another way — an inbound email from a member, a personal
 * API token. `kind` is optional so every existing literal stays a person; only a machine sets it.
 */
export interface AbilityActor {
    kind?: 'person'
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

/**
 * The issuer keel's own per-org service keys vouch as (packages/keel/src/service-auth/verify.ts →
 * `abilityActorFromService`). The one machine the framework grants a base-subject power to; see
 * {@link frameworkMachineRules}.
 */
export const SERVICE_KEY_ISSUER = 'service-key'

/**
 * A MACHINE acting in one org: a caller that is not a person — keel's own service keys, or a verifier
 * the app owns (a CI identity, an integration). Built by `abilityActorFromService` or `machineActor`
 * (../authz/authorize.ts), from a credential the route has already VERIFIED; never from request input.
 *
 * Deliberately has no `role`, no `restricted` and no `manageAll`: a machine is not a member of anything,
 * so nothing written for people can be satisfied by one. What a machine may do is exactly what
 * {@link frameworkMachineRules} and the app's `appMachineAbilityRules` grant it, and both deny by default.
 */
export interface MachineActor {
    kind: 'machine'
    /** What vouched for it: {@link SERVICE_KEY_ISSUER}, or a verifier the app names (`github-oidc`). */
    issuer: string
    /**
     * `<issuer>:<id>` — the machine's identity everywhere one is recorded: the audit trail's
     * `actor_user_id`, an owner column. Qualified by issuer so two verifiers' ids cannot collide.
     */
    principalId: string
    /** The org the verified credential is bound to — the anchor for every sameOrg check. */
    activeOrgId: string
}

/** Anyone `authorize()` can judge: a person or a machine. */
export type Actor = AbilityActor | MachineActor

/**
 * The id to RECORD for an actor — `recordAuditEvent`'s `actorUserId`, or an owner column: a person's
 * user id, or a machine's issuer-qualified principal id. One function so every call site attributes
 * a machine the same way.
 */
export function principalIdOf(actor: Actor): string {
    return actor.kind === 'machine' ? actor.principalId : actor.userId
}

/** The `sameOrg` helper the framework injects into every rule, its own and the app's. */
type SameOrg = (subject: AbilitySubject) => boolean

/**
 * The contract the app's `appMachineAbilityRules` (src/app-config/abilities.ts) conforms to. It is
 * called for APP subjects only; base subjects are {@link frameworkMachineRules}'s. An app that grants
 * machines nothing registers `() => false`.
 */
export type MachineAbilityRules = (
    actor: MachineActor,
    action: AbilityAction,
    subject: AbilitySubject,
    helpers: { sameOrg: SameOrg },
) => boolean

type FrameworkMachineRule = (
    actor: MachineActor,
    action: AbilityAction,
    subject: AbilitySubject,
    sameOrg: SameOrg,
) => boolean
const denyMachine: FrameworkMachineRule = () => false

/**
 * What a MACHINE may do with each framework base subject. Keyed by BaseSubjectType, so a new base
 * subject cannot be added without deciding this. One grant only:
 * - Job: read|update = a keel service-key caller, sameOrg. It is the counterparty the job service API
 *   exists for — it polls its own org's jobs and reports their status. Any other machine gets nothing.
 * - Everything else is denied: memberships, orgs and webhook endpoints are administrative acts a person
 *   answers for; User, Notification, NotificationPref and AgreementAcceptance are self-only and a machine
 *   has no self; the system-managed subjects have no per-actor rule for anyone.
 */
const frameworkMachineRules: Record<BaseSubjectType, FrameworkMachineRule> = {
    Job: (actor, action, subject, sameOrg) =>
        actor.issuer === SERVICE_KEY_ISSUER && (action === 'read' || action === 'update') && sameOrg(subject),
    Membership: denyMachine,
    Org: denyMachine,
    User: denyMachine,
    JobSchedule: denyMachine,
    WebhookEndpoint: denyMachine,
    WebhookDelivery: denyMachine,
    InboundEmail: denyMachine,
    Notification: denyMachine,
    NotificationPref: denyMachine,
    AgreementAcceptance: denyMachine,
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
 *
 * A MACHINE actor never reaches any of that: it is judged by {@link frameworkMachineRules} for base
 * subjects and the app's `appMachineAbilityRules` for its own, and both deny by default.
 */
export function defineAbilitiesFor(actor: Actor): Ability {
    // Same org iff the subject is org-scoped AND its org is the one the actor is acting in.
    const sameOrg: SameOrg = (subject) => subject.orgId != null && subject.orgId === actor.activeOrgId

    if (actor.kind === 'machine') {
        const machine = actor
        // Typed against the contract here, at CALL time rather than module load: a seam module that ever
        // value-imports this file would otherwise meet the binding before it is initialized.
        const appMachineRules: MachineAbilityRules = appMachineAbilityRules
        const machineCan = (action: AbilityAction, subject: AbilitySubject): boolean =>
            Object.hasOwn(frameworkMachineRules, subject.type)
                ? frameworkMachineRules[subject.type as BaseSubjectType](machine, action, subject, sameOrg)
                : appMachineRules(machine, action, subject, { sameOrg })
        return { can: machineCan, cannot: (action, subject) => !machineCan(action, subject) }
    }
    const person: AbilityActor = actor

    function can(action: AbilityAction, subject: AbilitySubject): boolean {
        // The staff-org superpower. manageAll precedes
        // the restricted checks: a restricted staff-org member would gain full authoring. Staff-org
        // membership is assumed non-restricted (nothing enforces it); if a restricted operator ever
        // becomes a real configuration, gate authoring verbs here first.
        if (person.manageAll) return true

        switch (subject.type) {
            case 'Job':
                if (action === 'read') return sameOrg(subject)
                if (action === 'create') return !person.restricted && sameOrg(subject)
                return false
            case 'Membership':
                if (action === 'read') return sameOrg(subject)
                if (action === 'create' || action === 'manage') return canManageOrg(person.role) && sameOrg(subject)
                return false
            case 'Org':
                if (action === 'read') return sameOrg(subject)
                if (action === 'update' || action === 'manage') return canManageOrg(person.role) && sameOrg(subject)
                return false
            case 'User':
                if (action === 'update') return subject.ownerId === person.userId
                return false
            case 'Notification':
                // Self-only (like User): read/mark-read only your OWN notifications. The route ALSO
                // filters by recipient_user_id (the rls-independent recipient guard) — belt and braces.
                if (action === 'read' || action === 'update') return subject.ownerId === person.userId
                return false
            case 'NotificationPref':
                // Self-only: a user manages ONLY their own preferences. read/update/create/manage all
                // require ownership; the route always uses the session's user id, never a client one.
                if (action === 'read' || action === 'update' || action === 'create' || action === 'manage') {
                    return subject.ownerId === person.userId
                }
                return false
            case 'AgreementAcceptance':
                // Self-only (like User/Notification): a user may record/read only THEIR OWN acceptance.
                // The route always uses the session's user id as ownerId, never a client-supplied one.
                if (action === 'create' || action === 'read') return subject.ownerId === person.userId
                return false
            case 'WebhookEndpoint':
                // Registering/managing an egress endpoint is an administrative act, gated like Org.
                if (action === 'read') return sameOrg(subject)
                if (action === 'create' || action === 'update' || action === 'delete') {
                    return canManageOrg(person.role) && sameOrg(subject)
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
                return appAbilityRules(person, action, subject, { sameOrg })
        }
    }

    return {
        can,
        cannot: (action, subject) => !can(action, subject),
    }
}
