/**
 * The access-gate seam — the reusable CLASS this slice exists to teach. PURE TypeScript
 * (ADR-0006, lint-enforced): no framework imports, shared verbatim by the server wiring
 * (src/app/[locale]/(protected)/layout.tsx) and the static-demo twin.
 *
 * A GATE is a condition an actor must satisfy before proceeding. It is DISTINCT from — and
 * COMPLEMENTS — the per-action authorization seam (packages/keel/src/authz/authorize.ts + packages/keel/src/core/abilities.ts):
 *
 *   - authorize() answers "may this actor perform THIS ONE action?" and DENIES (403) when not. It
 *     has no notion of resolution — a denied action is simply refused.
 *   - a gate answers "must this actor CLEAR something before proceeding?" and carries a
 *     resolution flow (how you clear it) plus a behavior (block vs advisory nudge).
 *
 * V1 ENFORCEMENT POSTURE (honest scope — pre-merge review): a block-all gate is enforced at the
 * PROTECTED LAYOUT only. It blocks every protected screen, but direct API mutations by a
 * blocked-but-authenticated user are NOT gated — API-level enforcement is exactly what the
 * action-scoped seam below exists to add, by hooking gate facts into authorize(). This is a
 * compliance/UX gate today, not a security boundary: the blocked actor holds unchanged abilities,
 * so nothing is exposed that authorize()/RLS don't already govern.
 *
 * The template already taught per-action deny; nothing taught block-with-resolution, which is the
 * new class here. The worked example shipped with the seam is agreements/clickwrap
 * (packages/keel/src/core/agreements.ts) — but the seam is deliberately domain-agnostic so future RIDERS plug in
 * without touching this file or the layout: email verification, MFA enrollment (the ADR-0003
 * deferral), onboarding completeness, training/certification, account suspension, and billing
 * entitlements are all gates of exactly this shape.
 *
 * The evaluation (evaluateGates) is PURE and INJECTABLE: the server assembles a plain `facts` object
 * from its data path and hands it, with the registered gates, to evaluateGates. No IO lives here, so
 * it is fully unit-testable and identical on every host.
 */

/**
 * Where a gate applies.
 *
 * - 'all'  — blocks/advises across the WHOLE protected area. The only scope IMPLEMENTED in v1: the
 *            protected layout renders an interstitial (block) or a banner (advisory) instead of / above
 *            the app when such a gate is pending.
 * - 'actions' — TYPED for the seam but NOT implemented this slice: a gate that gates a specific
 *            ability ACTION rather than the whole area (e.g. "you may read but not create until you
 *            re-accept"). See the SEAM NOTE at the bottom of this file for exactly where an
 *            action-scoped gate would hook into abilities/authorize — do NOT build it here.
 */
export type GateScope = 'all' | 'actions'

/** How a pending gate behaves: a block (interstitial replaces the protected UI — see the v1
 *  enforcement posture above) or an advisory nudge (dismissible banner, may proceed). */
export type GateBehavior = 'block' | 'advisory'

export interface Gate {
    /** Stable id, unique within the registry (e.g. `agreement:<uuid>`). Names the pending gate the
     *  server maps back to its resolution content. */
    id: string
    scope: GateScope
    behavior: GateBehavior
    /**
     * Route to the resolution flow. In v1 the agreements interstitial is rendered INSIDE the
     * protected layout (there is no separate resolution route to navigate to — see the layout's
     * comment and the decision log), so this is informational / telemetry for now and a genuine
     * navigation target for a future rider whose resolution lives on its own page.
     */
    resolutionPath: string
    /**
     * PURE predicate over the assembled facts: is this gate currently UNMET for the actor? Kept ON
     * the gate (rather than in a separate registry→predicate map) so a rider ships its gate and the
     * condition that makes it pending as ONE unit. evaluateGates calls this — it never inspects facts
     * itself, which is what keeps the seam domain-agnostic.
     */
    pending: (facts: GateFacts) => boolean
}

/** A gate that evaluated as pending for the current actor — the layout/twin renders from these. */
export interface PendingGate {
    id: string
    scope: GateScope
    behavior: GateBehavior
    resolutionPath: string
}

/**
 * The facts a gate is evaluated against — a plain object the server assembles per request from its
 * own data reads, then hands to evaluateGates. Deliberately an OPEN bag of optional keys: the
 * worked example (agreements) supplies `pendingAgreementIds`; a future rider adds its own key
 * (e.g. `emailVerified?: boolean`, `mfaEnrolled?: boolean`) without changing this signature or the
 * evaluator. A gate reads only the key(s) it cares about in its own `pending` predicate.
 */
export interface GateFacts {
    /** Ids of agreements the actor has NOT accepted at the current version (from packages/keel/src/core/agreements). */
    pendingAgreementIds?: string[]
    // FUTURE riders add fact keys here, e.g.:
    //   emailVerified?: boolean
    //   mfaEnrolled?: boolean
    //   onboardingComplete?: boolean
}

/**
 * Evaluate the registered gates against the actor's facts → the pending ones. Pure: filter each
 * registered gate through its own predicate, project to the serializable PendingGate shape, and
 * order BLOCK gates before advisory ones so a caller taking "the first blocker" is deterministic.
 *
 * `registered` is the UNIVERSE of gates that could apply (e.g. one per existing agreement); `facts`
 * says which actually apply to THIS actor. The intersection is the pending set. This universe-vs-actor
 * split is what lets a rider register a gate globally while the per-actor condition stays in facts.
 */
export function evaluateGates(registered: Gate[], facts: GateFacts): PendingGate[] {
    return registered
        .filter((gate) => gate.pending(facts))
        .map((gate): PendingGate => ({
            id: gate.id,
            scope: gate.scope,
            behavior: gate.behavior,
            resolutionPath: gate.resolutionPath,
        }))
        .sort((a, b) => behaviorRank(a.behavior) - behaviorRank(b.behavior))
}

/** The first pending BLOCK gate, if any — the one the protected layout renders an interstitial for.
 *  (evaluateGates already sorts block-first, but this states the intent at the call site.) */
export function firstBlockingGate(pending: PendingGate[]): PendingGate | undefined {
    return pending.find((gate) => gate.behavior === 'block')
}

/** The pending ADVISORY gates — rendered as dismissible banners above the app, never blocking. */
export function advisoryGates(pending: PendingGate[]): PendingGate[] {
    return pending.filter((gate) => gate.behavior === 'advisory')
}

/** block sorts before advisory. */
function behaviorRank(behavior: GateBehavior): number {
    return behavior === 'block' ? 0 : 1
}

/*
 * ── SEAM NOTE: action-scoped gates (GateScope 'actions') — documented, NOT built ──────────────────
 *
 * A v1 gate is always scope 'all': it is consulted ONCE, in the protected layout's data path, and
 * either blocks the whole area (interstitial) or advises (banner). An 'actions'-scoped gate would
 * instead gate a SPECIFIC ability action while leaving the rest of the app reachable — e.g. "a lapsed
 * ToS lets you READ but blocks CREATE until you re-accept".
 *
 * WHERE it would hook when built (do not implement now):
 *   - The natural point is packages/keel/src/authz/authorize.ts, alongside (and AFTER) the abilities check. After
 *     `defineAbilitiesFor(...).can(action, subject)` allows an action, authorize() would additionally
 *     consult the pending 'actions'-scoped gates for that (action, subjectType) and throw a distinct
 *     error (e.g. GateBlockedError → a 409/redirect carrying resolutionPath) rather than the plain
 *     403 ForbiddenError. The gate's `pending(facts)` predicate stays pure and unchanged; only the
 *     facts assembly moves into the request's authorize path (which already resolves the actor + org).
 *   - The gate would additionally carry which actions it scopes (e.g. `actions: AbilityAction[]` and
 *     an optional `subjectTypes: SubjectType[]`), read by that authorize()-side consultation. Those
 *     fields are intentionally ABSENT from the Gate type above so the v1 seam stays minimal — add
 *     them with the rider, not speculatively.
 *   - resolutionPath finally earns its keep here: an action-scoped block can't render in-layout (the
 *     actor is mid-flow), so authorize() would surface resolutionPath for the client to navigate to.
 *
 * This is written down (not built) on purpose — the round-2 doctrine: known patterns get recorded so
 * they aren't built early. The v1 'all'-scope gate is the whole implemented surface.
 */
