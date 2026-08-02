import type { Gate, GateBehavior, GateFacts, GateScope } from './gates'

/**
 * Agreements / clickwrap — the WORKED EXAMPLE that plugs into the gate seam (./gates.ts).
 * PURE TypeScript (ADR-0006): the version/acceptance arithmetic and the agreement→gate bridge live
 * here, shared verbatim by the server (packages/keel/src/db/agreements.ts assembles the rows) and the static-demo
 * twin. The reusable thing is the GATE (./gates.ts); agreements are one rider of it, with their
 * gating behavior carried as DATA on each agreement row (block-all / advisory) rather than in code.
 *
 * TENANT-scoped, deliberately: an agreement (the site's Terms of Service / privacy notice) applies to
 * EVERYONE in the tenant, not per-team — so unlike the org-scoped default (jobs, job_schedules, an
 * app’s own product tables) these rows are keyed to the tenant only. See migration 0013 and the
 * decision log for that deviation.
 */

export type AgreementKind = 'tos' | 'privacy' | 'custom'

/**
 * How an agreement gates when the actor hasn't accepted the current version.
 *
 * - 'block-all' — a hard block across the whole protected area (interstitial). Maps to a gate with
 *                 behavior 'block', scope 'all'.
 * - 'advisory'  — a dismissible banner; the actor may proceed. Maps to behavior 'advisory'.
 *
 * FUTURE 'block-actions' (an action-scoped block — read allowed, writes blocked) is intentionally NOT
 * a value here: it needs the action-scoped gate seam that ./gates.ts documents but does not build in
 * v1. Add it with that rider, not speculatively.
 */
export type AgreementGating = 'block-all' | 'advisory'

/** A current agreement version (the world state). `bodyMd` is the agreement text — markdown, rendered
 *  simply; it is world CONTENT (like a note body), not UI chrome, so it is NOT an i18n key. */
export interface AgreementView {
    id: string
    kind: AgreementKind
    version: number
    title: string
    bodyMd: string
    gating: AgreementGating
}

/** One acceptance record: the actor accepted `agreementId` AT `version` (the version is denormalized
 *  onto the acceptance so it survives later edits to the agreement — an old acceptance stays truthful
 *  about which version was agreed to). */
export interface AcceptanceView {
    agreementId: string
    version: number
    acceptedAt: string
}

/** A current agreement the actor still owes — never accepted, or accepted at an older version. Carries
 *  the full content so the interstitial/banner can render without a second lookup. */
export interface PendingAgreement {
    id: string
    kind: AgreementKind
    version: number
    title: string
    bodyMd: string
    gating: AgreementGating
}

/**
 * The pending agreements for one actor: for each CURRENT agreement, the actor owes it when they have
 * no acceptance for it, OR their highest accepted version is BELOW the current version (a version bump
 * re-arms the gate for everyone — the demo story). Order is preserved from `current`.
 *
 * Pure and side-effect-free — the same computation runs in the server data path and the twin. No
 * agreements at all ⇒ empty ⇒ no gates (the "clean world" case the tests pin).
 */
export function computePendingAgreements(current: AgreementView[], acceptances: AcceptanceView[]): PendingAgreement[] {
    // Highest accepted version per agreement id (an actor may have multiple acceptance rows across
    // version bumps; the max is what counts).
    const acceptedVersion = new Map<string, number>()
    for (const acceptance of acceptances) {
        const prior = acceptedVersion.get(acceptance.agreementId) ?? -Infinity
        if (acceptance.version > prior) acceptedVersion.set(acceptance.agreementId, acceptance.version)
    }

    return current
        .filter((agreement) => (acceptedVersion.get(agreement.id) ?? -Infinity) < agreement.version)
        .map((agreement) => ({
            id: agreement.id,
            kind: agreement.kind,
            version: agreement.version,
            title: agreement.title,
            bodyMd: agreement.bodyMd,
            gating: agreement.gating,
        }))
}

/**
 * Bridge the agreements domain onto the generic gate seam: turn the CURRENT agreements (the world's
 * universe of agreements) into the registry of gates evaluateGates expects. One gate per agreement;
 * behavior derives from its gating; each gate's `pending` predicate is "is my agreement id in the
 * actor's pending set" (read from GateFacts.pendingAgreementIds). scope is always 'all' in v1.
 *
 * This is the ONLY place agreements know about gates — the layout consumes the generic PendingGate
 * shape, so a future rider registers its own gates the same way with no layout change.
 */
export function gatesForAgreements(current: AgreementView[]): Gate[] {
    // v1 agreements are always area-wide ('all'); their block/advisory behavior comes from the row's
    // `gating`. Typing these against the seam's vocabulary keeps the mapping honest.
    const scope: GateScope = 'all'
    return current.map((agreement): Gate => {
        const behavior: GateBehavior = agreement.gating === 'advisory' ? 'advisory' : 'block'
        return {
            id: `agreement:${agreement.id}`,
            scope,
            behavior,
            resolutionPath: '/agreements',
            pending: (facts: GateFacts) => (facts.pendingAgreementIds ?? []).includes(agreement.id),
        }
    })
}

/** Assemble the GateFacts an actor's pending agreements imply — the plain object the server hands to
 *  evaluateGates. Shared by server + twin so both feed the seam identically. */
export function agreementFacts(pending: PendingAgreement[]): GateFacts {
    return { pendingAgreementIds: pending.map((agreement) => agreement.id) }
}

/** Recover the PendingAgreement a gate id refers to (the layout maps a pending BLOCK gate back to its
 *  agreement content for the interstitial). Returns undefined if the id isn't an agreement gate. */
export function pendingAgreementForGateId(gateId: string, pending: PendingAgreement[]): PendingAgreement | undefined {
    const prefix = 'agreement:'
    if (!gateId.startsWith(prefix)) return undefined
    const agreementId = gateId.slice(prefix.length)
    return pending.find((agreement) => agreement.id === agreementId)
}

/** Narrow an arbitrary string to a known AgreementKind (DB `kind` is text; validate at the boundary). */
export function isAgreementKind(value: string): value is AgreementKind {
    return value === 'tos' || value === 'privacy' || value === 'custom'
}

/** Narrow an arbitrary string to a known AgreementGating (DB `gating` is text; validate at the boundary). */
export function isAgreementGating(value: string): value is AgreementGating {
    return value === 'block-all' || value === 'advisory'
}
