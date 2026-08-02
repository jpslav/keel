import { describe, expect, it } from 'vitest'
import { advisoryGates, evaluateGates, firstBlockingGate, type Gate, type GateFacts } from './gates'

/** A minimal gate whose predicate reads one boolean fact key, for seam-level tests independent of
 *  the agreements rider. */
function boolGate(id: string, behavior: Gate['behavior'], pending: (facts: GateFacts) => boolean): Gate {
    return { id, scope: 'all', behavior, resolutionPath: `/resolve/${id}`, pending }
}

describe('evaluateGates', () => {
    it('returns only gates whose predicate is pending against the facts', () => {
        const gates = [
            boolGate('a', 'block', (f) => (f.pendingAgreementIds ?? []).includes('a')),
            boolGate('b', 'block', (f) => (f.pendingAgreementIds ?? []).includes('b')),
        ]
        const pending = evaluateGates(gates, { pendingAgreementIds: ['b'] })
        expect(pending.map((g) => g.id)).toEqual(['b'])
    })

    it('projects to the serializable PendingGate shape (no predicate leaks through)', () => {
        const gates = [boolGate('a', 'advisory', () => true)]
        const pending = evaluateGates(gates, {})
        expect(pending[0]).toEqual({ id: 'a', scope: 'all', behavior: 'advisory', resolutionPath: '/resolve/a' })
        expect('pending' in pending[0]!).toBe(false)
    })

    it('orders block gates before advisory gates deterministically', () => {
        const gates = [
            boolGate('advisory-1', 'advisory', () => true),
            boolGate('block-1', 'block', () => true),
            boolGate('advisory-2', 'advisory', () => true),
            boolGate('block-2', 'block', () => true),
        ]
        const pending = evaluateGates(gates, {})
        expect(pending.map((g) => g.behavior)).toEqual(['block', 'block', 'advisory', 'advisory'])
    })

    it('empty registry ⇒ no pending gates', () => {
        expect(evaluateGates([], { pendingAgreementIds: ['x'] })).toEqual([])
    })

    it('a gate reads only its own fact key — unrelated facts do not trip it', () => {
        // A future-rider-style gate keyed on a different (here, absent) fact stays non-pending while an
        // agreement gate is pending — proving facts is an open bag each gate reads selectively.
        const gates = [
            boolGate('agreement', 'block', (f) => (f.pendingAgreementIds ?? []).includes('agreement')),
            boolGate('other', 'block', (f) => (f as { emailVerified?: boolean }).emailVerified === false),
        ]
        const pending = evaluateGates(gates, { pendingAgreementIds: ['agreement'] })
        expect(pending.map((g) => g.id)).toEqual(['agreement'])
    })
})

describe('firstBlockingGate / advisoryGates', () => {
    it('firstBlockingGate returns the first block gate, or undefined when only advisories are pending', () => {
        const onlyAdvisory = evaluateGates([boolGate('a', 'advisory', () => true)], {})
        expect(firstBlockingGate(onlyAdvisory)).toBeUndefined()

        const mixed = evaluateGates([boolGate('adv', 'advisory', () => true), boolGate('blk', 'block', () => true)], {})
        expect(firstBlockingGate(mixed)?.id).toBe('blk')
    })

    it('advisoryGates returns only advisory pending gates', () => {
        const mixed = evaluateGates([boolGate('adv', 'advisory', () => true), boolGate('blk', 'block', () => true)], {})
        expect(advisoryGates(mixed).map((g) => g.id)).toEqual(['adv'])
    })
})
