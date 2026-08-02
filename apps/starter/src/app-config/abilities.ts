import type { AbilityAction, AbilityActor, AbilitySubject } from 'keel/core/abilities'

/**
 * The APP's authorization extension (the seam side of keel/core/abilities.ts, ADR-0012). The framework
 * owns the base subjects and the deny-by-default switch; this app registers ONE subject and its rules.
 * PURE TypeScript, same as core.
 */

/** The subject types this app adds on top of the framework's BaseSubjectType. */
export type AppSubjectType = 'Item'

/**
 * App-specific fields merged into the framework's AbilitySubject (`AbilitySubject extends
 * AppSubjectFields`). This app has NONE: every one of its subjects is scoped by the framework's own
 * `orgId`, so there is nothing to add.
 *
 * The empty interface is deliberate and is the one place "an unused capability needs no scaffolding"
 * is not quite free: because the framework EXTENDS this type, it must be an interface (a mapped type
 * such as `Record<never, never>` cannot be extended), and an empty interface is exactly what
 * `@typescript-eslint/no-empty-object-type` exists to flag. The suppression is narrow and local; the
 * alternative — inventing a field this app does not have — would be worse.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AppSubjectFields {}

/**
 * The designated staff/operator org slug. ACTIVE membership in this org grants the `manageAll`
 * ability-layer superpower (derived in keel/authz/authorize.ts). It is one ordinary org WITHIN a
 * tenant: staff powers stop at the tenant boundary and NEVER cross tenants (ADR-0004). WHICH org is
 * the operator org is an app choice, so it lives here; it must name a real seed org (`src/seed`).
 */
export const staffOrgSlug = 'ops'

/**
 * The app-subject anchor extras for the non-throwing UI gate (canInActiveOrg). This app adds no
 * subject fields, so there is nothing to anchor — the framework's own `orgId` anchor is enough, and
 * the injected anchor is ignored. (The parameter stays because the framework calls it with one.)
 */
export function anchorSubjectExtras(anchor: string): AppSubjectFields {
    void anchor // nothing to anchor: this app registers no subject fields of its own
    return {}
}

/**
 * The app's per-subject rules, invoked by keel/core/abilities.ts's `default:` case (deny by default).
 * `sameOrg` is injected by core so "the subject is org-scoped AND its org is the acting org" is
 * defined once.
 * - Item: read = sameOrg; create|update|delete = !restricted && sameOrg.
 */
export function appAbilityRules(
    actor: AbilityActor,
    action: AbilityAction,
    subject: AbilitySubject,
    { sameOrg }: { sameOrg: (subject: AbilitySubject) => boolean },
): boolean {
    switch (subject.type) {
        case 'Item':
            if (action === 'read') return sameOrg(subject)
            if (action === 'create' || action === 'update' || action === 'delete') {
                return !actor.restricted && sameOrg(subject)
            }
            return false
        default:
            // Deny by default: an app subject added here without a rule is denied.
            return false
    }
}
