import { describe, expect, test } from 'vitest'
import { InvalidTransitionError } from './state-machine'
import { FRAMEWORK_JOB_KINDS, isJobKind, JOB_STATUSES, jobStatusMachine } from './jobs'

describe('job status machine', () => {
    test('covers exactly the declared statuses', () => {
        expect([...jobStatusMachine.states].sort()).toEqual([...JOB_STATUSES].sort())
    })

    test('queued may start running or fail, but never jump straight to completed', () => {
        expect(jobStatusMachine.canTransition('queued', 'running')).toBe(true)
        expect(jobStatusMachine.canTransition('queued', 'failed')).toBe(true)
        expect(jobStatusMachine.canTransition('queued', 'completed')).toBe(false)
        expect(() => jobStatusMachine.assertTransition('queued', 'completed')).toThrow(InvalidTransitionError)
    })

    test('running may complete or fail', () => {
        expect(jobStatusMachine.canTransition('running', 'completed')).toBe(true)
        expect(jobStatusMachine.canTransition('running', 'failed')).toBe(true)
        expect(jobStatusMachine.canTransition('running', 'queued')).toBe(false)
    })

    test('completed and failed are terminal', () => {
        expect(jobStatusMachine.isTerminal('completed')).toBe(true)
        expect(jobStatusMachine.isTerminal('failed')).toBe(true)
        expect(jobStatusMachine.isTerminal('queued')).toBe(false)
        expect(jobStatusMachine.isTerminal('running')).toBe(false)
    })
})

describe('isJobKind', () => {
    // The app-registered kinds are asserted in src/app-config/jobs.test.ts — this proves the framework
    // side + the composed rejection of unknowns.
    test('narrows the framework kinds and rejects unknowns', () => {
        for (const kind of FRAMEWORK_JOB_KINDS) expect(isJobKind(kind)).toBe(true)
        expect(isJobKind('digest-email')).toBe(true)
        expect(isJobKind('delete-everything')).toBe(false)
        expect(isJobKind('')).toBe(false)
    })
})
