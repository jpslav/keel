import {
    appAbilityRules,
    appMachineAbilityRules,
    nonSessionAdministration,
    type AppMachineCredentialKind,
    type AppPersonCredentialKind,
    type AppSubjectFields,
    type AppSubjectType,
} from '@app-config/abilities'
import { canManageOrg, isRole, type Role } from './roles'

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
 * TWO KINDS OF ACTOR, each carrying the {@link Credential} it proved itself with (ADR-0012 addendum,
 * 2026-11-16):
 * - A PERSON ({@link AbilityActor}) is judged by the rules below, whether it came through a session or
 *   through another credential a person holds (an inbound email, a personal API token). Only an actor
 *   that STATES a session credential wields `manageAll`; for any other credential, or none, this file
 *   ignores it.
 * - A MACHINE ({@link MachineActor}), such as a service key or a CI identity, is judged by a SEPARATE,
 *   deny-by-default table: the framework's {@link frameworkMachineRules} for base subjects and the app's
 *   `appMachineAbilityRules` for its own. A machine has no role, no `restricted` flag and no
 *   `manageAll`, so it can never reach a rule written for people.
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
 * The credential kinds a PERSON can reach the app with: a browser `session`, an `inbound-email` from a
 * member's address (keel's intake), and whatever the app registers on the seam (`AppPersonCredentialKind`,
 * e.g. a personal API token). Composed, never edited, so an app's kinds need no framework change.
 */
export type PersonCredentialKind = 'session' | 'inbound-email' | AppPersonCredentialKind

/**
 * The credential kinds a MACHINE can reach the app with: keel's own per-org `service-key`, and whatever
 * the app registers on the seam (`AppMachineCredentialKind`, e.g. a CI OIDC token).
 */
export type MachineCredentialKind = 'service-key' | AppMachineCredentialKind

/**
 * The framework subjects whose non-read actions take a browser SESSION:
 * - ADMINISTRATION: inviting and managing members (Membership), changing the org (Org), registering and
 *   managing outbound webhook endpoints (WebhookEndpoint);
 * - ACCEPTING TERMS (AgreementAcceptance): a legal act a person makes in a browser, not by token or email.
 * A person may take these only through a stated session, unless the app widens one to a non-session
 * kind on the seam (`nonSessionAdministration`). Reads are not gated.
 *
 * Not listed: service keys (no route mints one, and they are no ability subject), the other self-only
 * subjects (User, Notification, NotificationPref: a person acting on their own things), the
 * system-managed subjects (JobSchedule, WebhookDelivery, InboundEmail: denied to everyone), and Job (a
 * product action).
 */
export const ADMINISTRATIVE_SUBJECTS = ['Membership', 'Org', 'WebhookEndpoint', 'AgreementAcceptance'] as const
export type AdministrativeSubjectType = (typeof ADMINISTRATIVE_SUBJECTS)[number]

/**
 * The non-session person credentials an app may widen a session-only subject to. Never `inbound-email`:
 * an email's From line is the weakest credential keel has, so nothing it sends may administer anything.
 * (`defineAbilitiesFor` refuses it at run time too, against a cast.)
 */
export type WidenableCredentialKind = Exclude<PersonCredentialKind, 'session' | 'inbound-email'>

/**
 * The contract for the app's `nonSessionAdministration` (src/app-config/abilities.ts): for each
 * session-only subject, the non-session person credential kinds that may act on it too. Empty, the
 * default, means each takes a browser session.
 */
export type NonSessionAdministration = {
    readonly [Subject in AdministrativeSubjectType]?: readonly WidenableCredentialKind[]
}

/**
 * True when two kind unions share no member, checked in BOTH directions: `Extract<A, B>` alone misses a
 * wide member, since `string` is not assignable to `'service-key'` while `'service-key'` is to `string`.
 */
type Disjoint<A, B> = [Extract<A, B> | Extract<B, A>] extends [never] ? true : false
/** True when a kind union is a set of named kinds, not `string` (which would admit every kind). */
type Named<K> = string extends K ? false : true

/**
 * The two kind unions must not overlap: a kind is a person's or a machine's, never both, or an audit
 * row's `credential_kind` could not say which. And each must be NAMED kinds: an app that registers
 * `string` would let a person claim `service-key`. Either mistake fails the typecheck here.
 */
const credentialKindsAreDisjoint: Disjoint<PersonCredentialKind, MachineCredentialKind> = true
const credentialKindsAreNamed: Named<PersonCredentialKind> & Named<MachineCredentialKind> = true
void credentialKindsAreDisjoint
void credentialKindsAreNamed

/**
 * HOW an actor proved who it is. `id` names WHICH credential (a token's row id, a service key's id, the
 * inbound email's id), so an audit row can say which one acted and a revocation can be traced. It is
 * never a secret. `null` when there is nothing to name: a session.
 */
export interface Credential<Kind extends string = PersonCredentialKind | MachineCredentialKind> {
    kind: Kind
    id: string | null
}

/** The fields every PERSON actor has, whichever credential brought them. */
interface PersonActorFields {
    kind?: 'person'
    userId: string
    /** Role in the ACTIVE org (mirrors AuthUser.role). */
    role: Role
    /** Limited-access seam: restricted members have a reduced feature surface (auth port). */
    restricted: boolean
    /** The org this actor is currently acting in — the anchor for every sameOrg check. */
    activeOrgId: string
}

/**
 * A PERSON acting in one org: built from a session by `abilityActorFromUser`, or, for a person who
 * reached the app with another credential, by `abilityActorFromCredential`, which re-reads the person's
 * standing through the auth port on every call (both in ../authz/authorize.ts). `kind` and `credential`
 * are optional, so a literal written before credentials existed still compiles where it can, and is still
 * judged by the person rules.
 *
 * TWO SHAPES, so the one mistake that matters is a type error. An actor whose `manageAll` may be true
 * must STATE a session credential, because only a stated session wields it ({@link defineAbilitiesFor}
 * enforces that at run time too). Every other actor has `manageAll: false`:
 * - `credential`: how this person reached the app. Absent means NOT STATED, which is never read as a
 *   session: such an actor does not wield `manageAll`, takes no administrative action on a framework
 *   subject, and records no credential in the audit trail. A literal that stands for a session says
 *   `{ kind: 'session', id: null }`, as `abilityActorFromUser` does.
 * - `manageAll`: the staff-org superpower, and it is LIVE. `abilityActorFromUser` sets it when the actor
 *   is ACTING AS the app's designated operator org (`staffOrgSlug` on the ADR-0012 seam). True
 *   short-circuits every per-subject rule below. It never crosses tenants: the rules it skips are already
 *   tenant-bounded, and every product query still runs inside withTenant (ADR-0004).
 */
export type AbilityActor = PersonActorFields &
    (
        | { credential?: Credential<PersonCredentialKind>; manageAll: false }
        | { credential: Credential<'session'>; manageAll: boolean }
    )

/**
 * A MACHINE acting in one org: a caller that is not a person — keel's own service keys, or a verifier
 * the app owns (a CI identity, an integration). Built by `abilityActorFromService` or `machineActor`
 * (../authz/authorize.ts), from a credential the route has already VERIFIED. Nothing in the type can
 * tell a verified machine from a literal built out of request input. Under `service/` the authorize
 * scan also requires `withServiceCaller`; anywhere else, the route is the only guard.
 *
 * Deliberately has no `role`, no `restricted` and no `manageAll`: a machine is not a member of anything,
 * so nothing written for people can be satisfied by one. What a machine may do is exactly what
 * {@link frameworkMachineRules} and the app's `appMachineAbilityRules` grant it, and both deny by default.
 */
export interface MachineActor {
    kind: 'machine'
    /** What vouched for it: keel's `service-key`, or a credential kind the app registers (a CI token). */
    credential: Credential<MachineCredentialKind>
    /**
     * `<credential kind>:<machine id>` — the machine's identity everywhere one is recorded: the audit
     * trail's `actor_user_id`, an owner column. Qualified by kind so two verifiers' ids cannot collide.
     */
    principalId: string
    /** The org the verified credential is bound to — the anchor for every sameOrg check. */
    activeOrgId: string
}

/** Anyone `authorize()` can judge: a person or a machine. */
export type Actor = AbilityActor | MachineActor

/**
 * The id to RECORD for an actor — `recordAuditEvent`'s `actorUserId`, or an owner column: a person's
 * user id, or a machine's kind-qualified principal id. One function so every call site attributes
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
        actor.credential.kind === 'service-key' && (action === 'read' || action === 'update') && sameOrg(subject),
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
 *
 * NARROWING. The app's rules see `actor.credential.kind`, so "this needs a browser session" is a line in
 * `appAbilityRules`. A per-CREDENTIAL ceiling (one token allowed less than its owner) is not built; if
 * one is ever needed it intersects here, `can(...) && withinCeiling(actor.credential, action, subject)`,
 * so every caller of `can` honours it.
 */
export function defineAbilitiesFor(actor: Actor): Ability {
    // Same org iff the subject is org-scoped AND its org is the one the actor is acting in.
    const sameOrg: SameOrg = (subject) => subject.orgId != null && subject.orgId === actor.activeOrgId

    if (actor.kind === 'machine') {
        const machine = actor
        // Typed against the contract here, at CALL time rather than module load. A seam module that
        // value-imports this file AND exports this rule as a `const` would otherwise meet the binding before
        // it is initialized (an `export function` is hoisted and would not).
        const appMachineRules: MachineAbilityRules = appMachineAbilityRules
        const machineCan = (action: AbilityAction, subject: AbilitySubject): boolean =>
            Object.hasOwn(frameworkMachineRules, subject.type)
                ? frameworkMachineRules[subject.type as BaseSubjectType](machine, action, subject, sameOrg)
                : appMachineRules(machine, action, subject, { sameOrg })
        return { can: machineCan, cannot: (action, subject) => !machineCan(action, subject) }
    }
    // The person is judged as a COPY made by naming each field the rules read, never as `{ ...actor }`:
    // a spread copies own enumerable fields only, so an actor whose fields are getters on a class, or
    // live on a prototype, would arrive with no `restricted` and no `userId`. What is copied is what is
    // validated, and what is validated is all that is judged.
    const fields = personFieldsOf(actor)
    // Anything that is not a well-formed person is denied everything. A machine-shaped object that lost
    // its `kind` (a cast, a value rehydrated from storage) would otherwise be judged as a person with no
    // role, and `!restricted` holds for an undefined flag.
    if (!isWellFormedPerson(fields)) return { can: () => false, cannot: () => true }
    const copy = fields as AbilityActor

    // The staff superpower belongs to a SESSION acting as the operator org. Enforced here rather than
    // trusted to whoever built the actor: a person who came through any other credential (an email, a
    // token), or who states none, never wields it, even acting in the staff org. The app's rules are
    // handed the same effective value.
    const session = copy.credential?.kind === 'session'
    // Read at call time, like the app's machine rules (see the machine branch above).
    const widening: NonSessionAdministration = nonSessionAdministration
    const person: AbilityActor =
        copy.manageAll && session
            ? { ...copy, manageAll: true, credential: { kind: 'session', id: copy.credential?.id ?? null } }
            : { ...copy, manageAll: false }
    // sameOrg for the person reads the COPY's org, like every other person rule.
    const personSameOrg: SameOrg = (subject) => subject.orgId != null && subject.orgId === person.activeOrgId

    function can(action: AbilityAction, subject: AbilitySubject): boolean {
        // The staff-org superpower. manageAll precedes
        // the restricted checks: a restricted staff-org member would gain full authoring. Staff-org
        // membership is assumed non-restricted (nothing enforces it); if a restricted operator ever
        // becomes a real configuration, gate authoring verbs here first.
        if (person.manageAll) return true

        // Administration, and accepting terms, take a stated session, unless the app widened this subject
        // to this credential.
        // A refusal here is final; a pass falls through to the subject's own rule below.
        if (action !== 'read' && (ADMINISTRATIVE_SUBJECTS as readonly string[]).includes(subject.type) && !session) {
            const widenedTo: readonly string[] = widening[subject.type as AdministrativeSubjectType] ?? []
            const kind = person.credential?.kind
            // `inbound-email` is refused even if a cast put it in the list (WidenableCredentialKind).
            if (kind === undefined || kind === 'inbound-email' || !widenedTo.includes(kind)) return false
        }

        switch (subject.type) {
            case 'Job':
                if (action === 'read') return personSameOrg(subject)
                if (action === 'create') return !person.restricted && personSameOrg(subject)
                return false
            case 'Membership':
                if (action === 'read') return personSameOrg(subject)
                if (action === 'create' || action === 'manage')
                    return canManageOrg(person.role) && personSameOrg(subject)
                return false
            case 'Org':
                if (action === 'read') return personSameOrg(subject)
                if (action === 'update' || action === 'manage')
                    return canManageOrg(person.role) && personSameOrg(subject)
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
                if (action === 'read') return personSameOrg(subject)
                if (action === 'create' || action === 'update' || action === 'delete') {
                    return canManageOrg(person.role) && personSameOrg(subject)
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
                return appAbilityRules(person, action, subject, { sameOrg: personSameOrg })
        }
    }

    return {
        can,
        cannot: (action, subject) => !can(action, subject),
    }
}

/** The loose record {@link personFieldsOf} copies into, before it is validated. */
interface PersonFieldsCopy {
    kind: unknown
    credential: unknown
    userId: unknown
    role: unknown
    restricted: unknown
    activeOrgId: unknown
    manageAll: unknown
}

/**
 * Copy, by NAME, every field the person rules read, reading through getters and prototypes exactly
 * once. The credential is copied too, so a getter cannot answer `session` to the check and something
 * else to the rule.
 */
function personFieldsOf(actor: AbilityActor): PersonFieldsCopy {
    const loose = actor as unknown as Record<string, unknown>
    const credential = loose.credential as { kind?: unknown; id?: unknown } | undefined | null
    return {
        kind: loose.kind,
        credential: credential == null ? undefined : { kind: credential.kind, id: credential.id },
        userId: loose.userId,
        role: loose.role,
        restricted: loose.restricted,
        activeOrgId: loose.activeOrgId,
        manageAll: loose.manageAll,
    }
}

/**
 * The shape the person rules can judge: `kind` is 'person' or absent, `role` is a real role,
 * `restricted` and `manageAll` are booleans, and a credential, if any, has a string kind. The type
 * promises this; the check is for values that arrive around it.
 */
function isWellFormedPerson(loose: PersonFieldsCopy): boolean {
    const credential = loose.credential as { kind?: unknown; id?: unknown } | undefined
    return (
        (loose.kind === undefined || loose.kind === 'person') &&
        typeof loose.role === 'string' &&
        isRole(loose.role) &&
        typeof loose.restricted === 'boolean' &&
        typeof loose.userId === 'string' &&
        typeof loose.activeOrgId === 'string' &&
        typeof loose.manageAll === 'boolean' &&
        (credential === undefined ||
            (typeof credential.kind === 'string' && (credential.id === null || typeof credential.id === 'string')))
    )
}
