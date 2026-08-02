import { describe, expect, it } from 'vitest'
import {
    type AcceptanceView,
    type AgreementView,
    agreementFacts,
    computePendingAgreements,
    gatesForAgreements,
    isAgreementGating,
    isAgreementKind,
    pendingAgreementForGateId,
} from './agreements'
import { evaluateGates, firstBlockingGate } from './gates'

const tos: AgreementView = {
    id: 'tos-1',
    kind: 'tos',
    version: 1,
    title: 'Terms of Service',
    bodyMd: '# Terms\nBe excellent.',
    gating: 'block-all',
}
const privacy: AgreementView = {
    id: 'privacy-1',
    kind: 'privacy',
    version: 1,
    title: 'Privacy Notice',
    bodyMd: 'We respect your data.',
    gating: 'advisory',
}

const accepted = (agreementId: string, version: number): AcceptanceView => ({
    agreementId,
    version,
    acceptedAt: '2026-07-23T00:00:00.000Z',
})

describe('computePendingAgreements', () => {
    it('no agreements at all ⇒ no pending', () => {
        expect(computePendingAgreements([], [])).toEqual([])
    })

    it('an unaccepted agreement is pending', () => {
        const pending = computePendingAgreements([tos], [])
        expect(pending.map((a) => a.id)).toEqual(['tos-1'])
    })

    it('an agreement accepted at the current version is NOT pending', () => {
        expect(computePendingAgreements([tos], [accepted('tos-1', 1)])).toEqual([])
    })

    it('a version bump re-arms the gate (accepted below current ⇒ pending again)', () => {
        const tosV2: AgreementView = { ...tos, version: 2 }
        const pending = computePendingAgreements([tosV2], [accepted('tos-1', 1)])
        expect(pending.map((a) => a.version)).toEqual([2])
    })

    it('uses the HIGHEST accepted version across multiple acceptance rows', () => {
        const tosV2: AgreementView = { ...tos, version: 2 }
        // rows out of order; the max (2) satisfies the current version (2)
        expect(computePendingAgreements([tosV2], [accepted('tos-1', 1), accepted('tos-1', 2)])).toEqual([])
    })

    it('preserves order and carries full content for each pending agreement', () => {
        const pending = computePendingAgreements([tos, privacy], [])
        expect(pending.map((a) => a.id)).toEqual(['tos-1', 'privacy-1'])
        expect(pending[0]!.bodyMd).toBe(tos.bodyMd)
        expect(pending[1]!.gating).toBe('advisory')
    })
})

describe('gatesForAgreements ⨯ the gate seam', () => {
    it('a pending block-all agreement produces a pending BLOCK gate', () => {
        const gates = gatesForAgreements([tos])
        const pending = computePendingAgreements([tos], [])
        const evaluated = evaluateGates(gates, agreementFacts(pending))
        const blocker = firstBlockingGate(evaluated)
        expect(blocker?.id).toBe('agreement:tos-1')
        expect(blocker?.behavior).toBe('block')
    })

    it('a pending advisory agreement produces an ADVISORY gate (never blocks)', () => {
        const gates = gatesForAgreements([privacy])
        const pending = computePendingAgreements([privacy], [])
        const evaluated = evaluateGates(gates, agreementFacts(pending))
        expect(firstBlockingGate(evaluated)).toBeUndefined()
        expect(evaluated.map((g) => g.behavior)).toEqual(['advisory'])
    })

    it('an accepted agreement contributes a registered gate that evaluates as NOT pending', () => {
        const gates = gatesForAgreements([tos]) // universe still has the gate
        const pending = computePendingAgreements([tos], [accepted('tos-1', 1)]) // but nothing pending
        expect(evaluateGates(gates, agreementFacts(pending))).toEqual([])
    })

    it('block gate sorts before advisory when both are pending', () => {
        const gates = gatesForAgreements([privacy, tos])
        const pending = computePendingAgreements([privacy, tos], [])
        const evaluated = evaluateGates(gates, agreementFacts(pending))
        expect(evaluated.map((g) => g.behavior)).toEqual(['block', 'advisory'])
    })
})

describe('pendingAgreementForGateId', () => {
    it('maps a gate id back to its pending agreement content', () => {
        const pending = computePendingAgreements([tos], [])
        expect(pendingAgreementForGateId('agreement:tos-1', pending)?.title).toBe('Terms of Service')
    })

    it('returns undefined for a non-agreement gate id or an unknown agreement', () => {
        const pending = computePendingAgreements([tos], [])
        expect(pendingAgreementForGateId('mfa:enroll', pending)).toBeUndefined()
        expect(pendingAgreementForGateId('agreement:nope', pending)).toBeUndefined()
    })
})

describe('boundary narrowers', () => {
    it('isAgreementKind', () => {
        expect(isAgreementKind('tos')).toBe(true)
        expect(isAgreementKind('privacy')).toBe(true)
        expect(isAgreementKind('custom')).toBe(true)
        expect(isAgreementKind('nope')).toBe(false)
    })
    it('isAgreementGating', () => {
        expect(isAgreementGating('block-all')).toBe(true)
        expect(isAgreementGating('advisory')).toBe(true)
        expect(isAgreementGating('block-actions')).toBe(false)
    })
})
