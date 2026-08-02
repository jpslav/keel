import { describe, expect, test } from 'vitest'
import { InvalidTransitionError } from 'keel/core/state-machine'
import { isEscalationStatus, ESCALATION_STATUSES, escalationMachine } from './escalations'

describe('escalation status machine', () => {
    test('covers exactly the declared statuses', () => {
        expect([...escalationMachine.states].sort()).toEqual([...ESCALATION_STATUSES].sort())
    })

    test('an open request may be accepted, rejected, or cancelled', () => {
        expect(escalationMachine.canTransition('open', 'accepted')).toBe(true)
        expect(escalationMachine.canTransition('open', 'rejected')).toBe(true)
        expect(escalationMachine.canTransition('open', 'cancelled')).toBe(true)
    })

    test('every decision is terminal — no second decision, no reopen', () => {
        for (const terminal of ['accepted', 'rejected', 'cancelled'] as const) {
            expect(escalationMachine.isTerminal(terminal)).toBe(true)
            expect(() => escalationMachine.assertTransition(terminal, 'accepted')).toThrow(InvalidTransitionError)
        }
        expect(escalationMachine.isTerminal('open')).toBe(false)
    })

    test('assertTransition carries from/to for an illegal hop (e.g. double-accept)', () => {
        try {
            escalationMachine.assertTransition('accepted', 'rejected')
            throw new Error('expected assertTransition to throw')
        } catch (error) {
            expect(error).toBeInstanceOf(InvalidTransitionError)
            const err = error as InvalidTransitionError
            expect(err.from).toBe('accepted')
            expect(err.to).toBe('rejected')
        }
    })
})

describe('isEscalationStatus', () => {
    test('narrows the declared statuses', () => {
        for (const status of ESCALATION_STATUSES) expect(isEscalationStatus(status)).toBe(true)
        expect(isEscalationStatus('open')).toBe(true)
        expect(isEscalationStatus('pending')).toBe(false)
        expect(isEscalationStatus('')).toBe(false)
    })
})
