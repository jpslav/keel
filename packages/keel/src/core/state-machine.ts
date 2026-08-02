/** Thrown by assertTransition when a hop isn't allowed by the machine's transition table. */
export class InvalidTransitionError extends Error {
    constructor(
        readonly from: string,
        readonly to: string,
    ) {
        super(`invalid transition: ${from} -> ${to}`)
        this.name = 'InvalidTransitionError'
    }
}

/**
 * A tiny finite-state-machine over string states (ADR-0006 pure-core). The transition table is the
 * single source of truth: a state with no outgoing transitions is terminal, and every hop is either
 * in the table or rejected. Deliberately generic so jobs (and anything else) can share the guard.
 */
export interface StateMachine<S extends string> {
    states: readonly S[]
    /** True when the state has no outgoing transitions. */
    isTerminal(state: S): boolean
    canTransition(from: S, to: S): boolean
    /** @throws InvalidTransitionError when the hop isn't in the table. */
    assertTransition(from: S, to: S): void
}

export function defineStateMachine<S extends string>(transitions: Record<S, readonly S[]>): StateMachine<S> {
    const states = Object.keys(transitions) as S[]
    const outgoing = (from: S): readonly S[] => transitions[from] ?? []
    return {
        states,
        isTerminal(state) {
            return outgoing(state).length === 0
        },
        canTransition(from, to) {
            return outgoing(from).includes(to)
        },
        assertTransition(from, to) {
            if (!outgoing(from).includes(to)) throw new InvalidTransitionError(from, to)
        },
    }
}
