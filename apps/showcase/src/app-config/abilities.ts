import type { AbilityAction, AbilityActor, AbilitySubject } from 'keel/core/abilities'
import { canManageOrg } from 'keel/core/roles'

/**
 * The APP's authorization extension (the seam side of packages/keel/src/core/abilities.ts, ADR-0012). The framework
 * owns the base subjects + the deny-by-default switch; the demo app registers its OWN subjects, their
 * rules, and the two-sided escalation fields HERE. A real adopter replaces this file's contents (its own
 * subjects/rules) without editing the framework's base union or switch. PURE TypeScript, same as core.
 *
 * Imported by packages/keel/src/core/abilities.ts through the `@app-config/*` seam alias (deliberately distinct from
 * the fenced `@/app-config/*` path so framework→seam registration is allowed; see ADR-0012).
 */

/** The subject types this app adds on top of the framework's BaseSubjectType. */
export type AppSubjectType = 'Ticket' | 'Escalation' | 'Attachment'

/**
 * App-specific fields merged into the framework's AbilitySubject (core/abilities.ts `extends
 * AppSubjectFields`). The two-sided escalation carries a named org id per side instead of a single
 * `orgId`, so its scoping fields live with the app that defines Escalation. The two sides keep the
 * neutral requester/responder names: the desk that RAISES an escalation is the requester, the team
 * that DECIDES it is the responder.
 */
export interface AppSubjectFields {
    /** Escalation — the desk that raised it. `null`/absent never matches a side. */
    requesterOrgId?: string | null
    /** Escalation — the team it was handed to. `null`/absent never matches a side. */
    responderOrgId?: string | null
}

/**
 * The designated staff/operator org slug. ACTIVE membership in this org — acting AS it —
 * grants the `manageAll` ability-layer superpower (derived in packages/keel/src/authz/authorize.ts). It is one
 * ordinary org WITHIN a tenant: staff powers stop at the tenant boundary and NEVER cross tenants
 * (ADR-0004). It lives on the seam (not packages/keel/src/core/roles.ts) because WHICH org is the operator org is an
 * app/deployment choice — an adopter names their own; the framework only knows "there is a staff org".
 *
 * DISAMBIGUATION (deliberately): this org slug `desk-ops` is NOT the rank-ladder role `'staff'`
 * (packages/keel/src/core/roles.ts). The role `'staff'` is an org-manager RANK (canManageOrg, may invite) held
 * within any org. The org `desk-ops` is the operator org whose ACTIVE membership activates cross-org
 * manage-all. A person can hold role `'admin'` in the `desk-ops` org (Olive does) — orthogonal.
 *
 * TENANT SEMANTICS (intended): the slug is matched per-tenant, so in production — where org slugs are
 * only tenant-unique — ANY tenant that names an org `desk-ops` designates its own operator org, with
 * manage-all strictly inside that tenant (ADR-0004). Cross-referenced by packages/seed's desk-ops org.
 */
export const staffOrgSlug = 'desk-ops'

/**
 * The app-subject anchor extras for the non-throwing UI gate (canInActiveOrg). Both escalation sides are
 * stood in for by the actor's own active-org anchor, so a create-gate reads as "am I the raising desk"
 * and an update-gate as "am I the receiving team". UI ONLY — server enforcement uses the row's real ids.
 */
export function anchorSubjectExtras(anchor: string): AppSubjectFields {
    return { requesterOrgId: anchor, responderOrgId: anchor }
}

/**
 * The app's per-subject rules, invoked by packages/keel/src/core/abilities.ts's `default:` case (deny by default).
 * `sameOrg` is injected by core so the "subject is org-scoped AND its org is the acting org" test is
 * defined once.
 * - Ticket:     read = sameOrg;  create|update|delete = !restricted && sameOrg. The desk's working
 *               data: an agent edits (status, assignee) and deletes their team's tickets, which is
 *               what PATCH/DELETE /api/tickets/[id] reach.
 * - Attachment: read = sameOrg;  create|delete        = !restricted && sameOrg (single-org, like Ticket).
 * - Escalation: two-sided. read = actor is EITHER side; create|delete (raise/withdraw) =
 *               !restricted && actor is the REQUESTER side; update (decide) = canManageOrg && actor
 *               is the RESPONDER side; manage = denied. A null side never matches.
 */
export function appAbilityRules(
    actor: AbilityActor,
    action: AbilityAction,
    subject: AbilitySubject,
    { sameOrg }: { sameOrg: (subject: AbilitySubject) => boolean },
): boolean {
    switch (subject.type) {
        case 'Ticket':
            if (action === 'read') return sameOrg(subject)
            if (action === 'create' || action === 'update' || action === 'delete') {
                return !actor.restricted && sameOrg(subject)
            }
            return false
        case 'Attachment':
            // Single-org scope, same shape as Ticket: anyone in the team may read; only a non-restricted
            // member may create (upload) or delete. Confirm re-uses the create rule (finalizing one's
            // own upload), so no separate 'update' rule is needed.
            if (action === 'read') return sameOrg(subject)
            if (action === 'create' || action === 'delete') return !actor.restricted && sameOrg(subject)
            return false
        case 'Escalation': {
            // Two-sided scoping: the actor is on the requester side, the responder side, or neither. A
            // null side never equals the active org, so an absent side never matches.
            const isRequester = subject.requesterOrgId != null && subject.requesterOrgId === actor.activeOrgId
            const isResponder = subject.responderOrgId != null && subject.responderOrgId === actor.activeOrgId
            if (action === 'read') return isRequester || isResponder
            // Raise an escalation / withdraw it (delete = soft-cancel): requester side, not restricted.
            if (action === 'create' || action === 'delete') return !actor.restricted && isRequester
            // Decide (accept/reject): responder side, and only an org manager may decide. Deliberately
            // NOT gated on `restricted` — the house rule is that `restricted` reduces the AUTHORING
            // surface, never management authority. A restricted manager on the responder side may still
            // decide; do not "fix" this to `!restricted && ...` without a product decision.
            if (action === 'update') return canManageOrg(actor.role) && isResponder
            return false
        }
        default:
            // Deny by default: an app subject added here without a rule (or a framework subject that
            // reaches this delegation) is denied.
            return false
    }
}
