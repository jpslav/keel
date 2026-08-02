import { describe, expect, test } from 'vitest'
import { defineStateMachine, InvalidTransitionError } from './state-machine'

type Light = 'red' | 'green' | 'yellow' | 'off'

const machine = defineStateMachine<Light>({
    red: ['green'],
    green: ['yellow'],
    yellow: ['red'],
    off: [],
})

describe('defineStateMachine', () => {
    test('exposes the declared states', () => {
        expect([...machine.states].sort()).toEqual(['green', 'off', 'red', 'yellow'])
    })

    test('canTransition accepts legal hops and rejects illegal ones', () => {
        expect(machine.canTransition('red', 'green')).toBe(true)
        expect(machine.canTransition('green', 'yellow')).toBe(true)
        expect(machine.canTransition('red', 'yellow')).toBe(false)
        expect(machine.canTransition('green', 'red')).toBe(false)
    })

    test('isTerminal detects states with no outgoing transitions', () => {
        expect(machine.isTerminal('off')).toBe(true)
        expect(machine.isTerminal('red')).toBe(false)
        expect(machine.isTerminal('green')).toBe(false)
    })

    test('assertTransition is a no-op for legal hops', () => {
        expect(() => machine.assertTransition('red', 'green')).not.toThrow()
    })

    test('assertTransition throws InvalidTransitionError carrying from/to for illegal hops', () => {
        try {
            machine.assertTransition('red', 'yellow')
            throw new Error('expected assertTransition to throw')
        } catch (error) {
            expect(error).toBeInstanceOf(InvalidTransitionError)
            const err = error as InvalidTransitionError
            expect(err.name).toBe('InvalidTransitionError')
            expect(err.from).toBe('red')
            expect(err.to).toBe('yellow')
        }
    })

    test('a transition out of a terminal state always throws', () => {
        expect(() => machine.assertTransition('off', 'red')).toThrow(InvalidTransitionError)
    })
})
