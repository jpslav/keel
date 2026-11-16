import type { AbilityAction, AbilityActor, AbilitySubject, MachineActor } from 'keel/core/abilities'

/**
 * The APP's authorization extension (the seam side of keel/core/abilities.ts, ADR-0012). The framework
 * owns the base subjects and the deny-by-default switch; the fixture registers ONE subject and its
 * rules. PURE TypeScript, same as core.
 */

/** The subject types the fixture adds on top of the framework's BaseSubjectType. */
export type AppSubjectType = 'Docket'

/**
 * App-specific fields merged into the framework's AbilitySubject (`AbilitySubject extends
 * AppSubjectFields`). The fixture has NONE: its one subject is scoped by the framework's own `orgId`.
 *
 * The empty interface is deliberate: because the framework EXTENDS this type it must be an interface (a
 * mapped type such as `Record<never, never>` cannot be extended), and an empty interface is exactly what
 * `@typescript-eslint/no-empty-object-type` exists to flag. The suppression is narrow and local.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AppSubjectFields {}

/**
 * The fixture's credential kinds beyond keel's own, one of each so keel's tests can build both kinds of
 * non-session actor: a `fixture-badge` is a credential a PERSON holds (the shape of a personal API token),
 * a `fixture-intake` one a MACHINE does (the shape of a CI identity).
 */
export type AppPersonCredentialKind = 'fixture-badge'
export type AppMachineCredentialKind = 'fixture-intake'

/**
 * The designated staff/operator org slug. ACTIVE membership in this org grants the `manageAll`
 * ability-layer superpower (derived in keel/authz/authorize.ts). It is one ordinary org WITHIN a
 * tenant: staff powers stop at the tenant boundary and NEVER cross tenants (ADR-0004). It must name a
 * real seed org — `steward` in ../seed.ts — and `authz/authorize.test.ts` imports this very value
 * rather than a literal, so the two can never drift.
 */
export const staffOrgSlug = 'steward'

/**
 * The app-subject anchor extras for the non-throwing UI gate (canInActiveOrg). The fixture adds no
 * subject fields, so there is nothing to anchor and the injected anchor is ignored. (The parameter
 * stays because the framework calls it with one.)
 */
export function anchorSubjectExtras(anchor: string): AppSubjectFields {
    void anchor // nothing to anchor: this app registers no subject fields of its own
    return {}
}

/**
 * The fixture's per-subject rules, invoked by keel/core/abilities.ts's `default:` case (deny by
 * default). `sameOrg` is injected by core so "the subject is org-scoped AND its org is the acting org"
 * is defined once.
 * - Docket: read = sameOrg; create|update|delete = !restricted && sameOrg, and delete only through a
 *   session (the one rule here that reads the actor's credential kind).
 *
 * The `!restricted` half is load-bearing: `inbound-email/intake.test.ts` proves the email path refuses
 * a restricted member exactly as the product UI would, and this is the rule it leans on.
 */
export function appAbilityRules(
    actor: AbilityActor,
    action: AbilityAction,
    subject: AbilitySubject,
    { sameOrg }: { sameOrg: (subject: AbilitySubject) => boolean },
): boolean {
    switch (subject.type) {
        case 'Docket':
            if (action === 'read') return sameOrg(subject)
            // Narrowing by credential KIND: deleting a docket takes a browser session, so a badge (the
            // fixture's personal-token shape) can file and edit dockets but not remove them.
            if (action === 'delete' && (actor.credential?.kind ?? 'session') !== 'session') return false
            if (action === 'create' || action === 'update' || action === 'delete') {
                return !actor.restricted && sameOrg(subject)
            }
            return false
        default:
            // Deny by default: an app subject added here without a rule is denied.
            return false
    }
}

/**
 * The fixture's rules for MACHINE actors (keel/core/abilities `MachineActor`), invoked for the fixture's
 * own subjects only — framework subjects have the framework's machine table. Deny by default, and kept
 * deliberately narrower than the person rule above so the tests can tell which table answered:
 * - Docket: create = a `fixture-intake` machine (an integration that files dockets), sameOrg. A machine
 *   never updates or deletes a docket, and no other kind of machine may file one.
 */
export function appMachineAbilityRules(
    actor: MachineActor,
    action: AbilityAction,
    subject: AbilitySubject,
    { sameOrg }: { sameOrg: (subject: AbilitySubject) => boolean },
): boolean {
    switch (subject.type) {
        case 'Docket':
            return actor.credential.kind === 'fixture-intake' && action === 'create' && sameOrg(subject)
        default:
            return false
    }
}
