import { describe, expect, test } from 'vitest'
import { isJobKind } from 'keel/core/jobs'
import { appJobHandlers, appJobKinds, jobHandlers, serviceManagedOrgSlugs } from './jobs'

// The APP's job registrations, and proof they compose into the framework's isJobKind + dispatch map.

describe('app job registrations', () => {
    test('isJobKind accepts the app-registered kinds (composed with the framework kinds)', () => {
        for (const kind of appJobKinds) expect(isJobKind(kind)).toBe(true)
        expect(isJobKind('export-tickets')).toBe(true)
    })

    test('every app kind has a handler; the composed map also carries the framework handler', () => {
        for (const kind of appJobKinds) expect(typeof appJobHandlers[kind]).toBe('function')
        expect(typeof jobHandlers['export-tickets']).toBe('function')
        expect(typeof jobHandlers['digest-email']).toBe('function')
    })

    test('serviceManagedOrgSlugs names the org the service actor serves (so the builder pool excludes it)', () => {
        expect(serviceManagedOrgSlugs).toContain('frontline')
    })
})
