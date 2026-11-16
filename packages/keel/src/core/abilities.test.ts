import { describe, expect, test } from 'vitest'
import { type AbilityActor, type MachineActor, defineAbilitiesFor, principalIdOf } from './abilities'
import type { Role } from './roles'

// Low-entropy, readable fixture ids only (gitleaks): no hex runs, no UUIDs.
const ORG_A = 'org-a'
const ORG_B = 'org-b'

function machine(overrides: Partial<MachineActor> = {}): MachineActor {
    const issuer = overrides.issuer ?? 'service-key'
    return { kind: 'machine', issuer, principalId: `${issuer}:wharf`, activeOrgId: ORG_A, ...overrides }
}

const ACTIONS = ['create', 'read', 'update', 'delete', 'manage'] as const

function actor(overrides: Partial<AbilityActor> & { role: Role }): AbilityActor {
    return {
        userId: 'user-1',
        restricted: false,
        activeOrgId: ORG_A,
        manageAll: false,
        ...overrides,
    }
}

// The FRAMEWORK base subjects. An app's own subjects and their rules are
// tested through the same defineAbilitiesFor in src/app-config/abilities.test.ts (ADR-0012 seam).
describe('defineAbilitiesFor', () => {
    describe('Job', () => {
        test('a guest (not restricted) may create and read jobs in the active org', () => {
            const ability = defineAbilitiesFor(actor({ role: 'guest' }))
            expect(ability.can('create', { type: 'Job', orgId: ORG_A })).toBe(true)
            expect(ability.can('read', { type: 'Job', orgId: ORG_A })).toBe(true)
        })

        test('a restricted member may read but not create jobs', () => {
            const ability = defineAbilitiesFor(actor({ role: 'restricted', restricted: true }))
            expect(ability.can('read', { type: 'Job', orgId: ORG_A })).toBe(true)
            expect(ability.can('create', { type: 'Job', orgId: ORG_A })).toBe(false)
        })

        test('jobs have no update/delete/manage rule', () => {
            const ability = defineAbilitiesFor(actor({ role: 'admin' }))
            for (const action of ['update', 'delete', 'manage'] as const) {
                expect(ability.can(action, { type: 'Job', orgId: ORG_A })).toBe(false)
            }
        })

        test('no job action reaches another org', () => {
            const ability = defineAbilitiesFor(actor({ role: 'member', activeOrgId: ORG_A }))
            for (const action of ['create', 'read'] as const) {
                expect(ability.can(action, { type: 'Job', orgId: ORG_B })).toBe(false)
            }
        })

        test('a job with no org (null/absent) is never in-scope', () => {
            const ability = defineAbilitiesFor(actor({ role: 'admin' }))
            expect(ability.can('read', { type: 'Job', orgId: null })).toBe(false)
            expect(ability.can('read', { type: 'Job' })).toBe(false)
        })
    })

    describe('Membership', () => {
        test('only org managers (admin, staff) may create/manage memberships in the active org', () => {
            for (const role of ['admin', 'staff'] as const) {
                const ability = defineAbilitiesFor(actor({ role }))
                expect(ability.can('create', { type: 'Membership', orgId: ORG_A })).toBe(true)
                expect(ability.can('manage', { type: 'Membership', orgId: ORG_A })).toBe(true)
            }
            for (const role of ['member', 'guest', 'restricted'] as const) {
                const ability = defineAbilitiesFor(actor({ role }))
                expect(ability.can('create', { type: 'Membership', orgId: ORG_A })).toBe(false)
                expect(ability.can('manage', { type: 'Membership', orgId: ORG_A })).toBe(false)
            }
        })

        test('any member of the org may read memberships', () => {
            const ability = defineAbilitiesFor(actor({ role: 'member' }))
            expect(ability.can('read', { type: 'Membership', orgId: ORG_A })).toBe(true)
        })

        test('a manager cannot manage memberships in an org they are not acting in', () => {
            const ability = defineAbilitiesFor(actor({ role: 'admin', activeOrgId: ORG_A }))
            expect(ability.can('create', { type: 'Membership', orgId: ORG_B })).toBe(false)
        })
    })

    describe('Org', () => {
        test('managers may update/manage the active org; non-managers may only read', () => {
            const manager = defineAbilitiesFor(actor({ role: 'staff' }))
            expect(manager.can('update', { type: 'Org', orgId: ORG_A })).toBe(true)
            expect(manager.can('manage', { type: 'Org', orgId: ORG_A })).toBe(true)

            const plain = defineAbilitiesFor(actor({ role: 'member' }))
            expect(plain.can('read', { type: 'Org', orgId: ORG_A })).toBe(true)
            expect(plain.can('update', { type: 'Org', orgId: ORG_A })).toBe(false)
            expect(plain.can('manage', { type: 'Org', orgId: ORG_A })).toBe(false)
        })
    })

    describe('User', () => {
        test('a user may update only themselves', () => {
            const ability = defineAbilitiesFor(actor({ role: 'member', userId: 'user-1' }))
            expect(ability.can('update', { type: 'User', ownerId: 'user-1' })).toBe(true)
            expect(ability.can('update', { type: 'User', ownerId: 'user-2' })).toBe(false)
        })

        test('self-update is independent of org (no orgId needed)', () => {
            const ability = defineAbilitiesFor(actor({ role: 'restricted', restricted: true, userId: 'user-1' }))
            expect(ability.can('update', { type: 'User', ownerId: 'user-1' })).toBe(true)
        })
    })

    describe('AgreementAcceptance (self-only)', () => {
        test('a user may create/read only their OWN acceptance, even when restricted', () => {
            const ability = defineAbilitiesFor(actor({ role: 'restricted', restricted: true, userId: 'user-1' }))
            expect(ability.can('create', { type: 'AgreementAcceptance', ownerId: 'user-1' })).toBe(true)
            expect(ability.can('read', { type: 'AgreementAcceptance', ownerId: 'user-1' })).toBe(true)
        })

        test('a user may not accept on behalf of someone else', () => {
            const ability = defineAbilitiesFor(actor({ role: 'admin', userId: 'user-1' }))
            expect(ability.can('create', { type: 'AgreementAcceptance', ownerId: 'user-2' })).toBe(false)
        })

        test('update/delete/manage are denied (acceptances are append-only, accept-for-self only)', () => {
            const ability = defineAbilitiesFor(actor({ role: 'admin', userId: 'user-1' }))
            for (const action of ['update', 'delete', 'manage'] as const) {
                expect(ability.can(action, { type: 'AgreementAcceptance', ownerId: 'user-1' })).toBe(false)
            }
        })
    })

    describe('WebhookEndpoint (org-admin only)', () => {
        test('only org managers may create/update/delete an endpoint; any member may read', () => {
            const manager = defineAbilitiesFor(actor({ role: 'admin' }))
            for (const action of ['create', 'update', 'delete'] as const) {
                expect(manager.can(action, { type: 'WebhookEndpoint', orgId: ORG_A })).toBe(true)
            }
            const plain = defineAbilitiesFor(actor({ role: 'member' }))
            expect(plain.can('read', { type: 'WebhookEndpoint', orgId: ORG_A })).toBe(true)
            expect(plain.can('create', { type: 'WebhookEndpoint', orgId: ORG_A })).toBe(false)
        })
    })

    describe('system-managed subjects have no per-actor rule', () => {
        test('JobSchedule / WebhookDelivery / InboundEmail are denied every action', () => {
            const ability = defineAbilitiesFor(actor({ role: 'admin' }))
            for (const type of ['JobSchedule', 'WebhookDelivery', 'InboundEmail'] as const) {
                for (const action of ['create', 'read', 'update', 'delete', 'manage'] as const) {
                    expect(ability.can(action, { type, orgId: ORG_A })).toBe(false)
                }
            }
        })
    })

    describe('manageAll (reserved staff-org superpower)', () => {
        test('short-circuits every rule to allow', () => {
            const god = defineAbilitiesFor(actor({ role: 'restricted', restricted: true, manageAll: true }))
            expect(god.can('create', { type: 'Job', orgId: ORG_B })).toBe(true)
            expect(god.can('manage', { type: 'Membership', orgId: ORG_B })).toBe(true)
            expect(god.can('update', { type: 'User', ownerId: 'user-2' })).toBe(true)
        })

        test('is off by default so it changes nothing this slice', () => {
            const ability = defineAbilitiesFor(actor({ role: 'restricted', restricted: true }))
            expect(ability.can('create', { type: 'Job', orgId: ORG_A })).toBe(false)
        })
    })

    test('cannot is the negation of can', () => {
        const ability = defineAbilitiesFor(actor({ role: 'restricted', restricted: true }))
        expect(ability.cannot('create', { type: 'Job', orgId: ORG_A })).toBe(true)
        expect(ability.cannot('read', { type: 'Job', orgId: ORG_A })).toBe(false)
    })

    // MACHINE actors: judged by a separate, deny-by-default table — the framework's for base subjects,
    // the seam's appMachineAbilityRules for the app's own. Under the fixture seam that grants exactly
    // one thing: a `fixture-intake` machine may create a Docket in its own org.
    describe('machine actors', () => {
        test("a service-key machine may read and update (report status on) its own org's jobs, nothing more", () => {
            const ability = defineAbilitiesFor(machine())
            expect(ability.can('read', { type: 'Job', orgId: ORG_A })).toBe(true)
            expect(ability.can('update', { type: 'Job', orgId: ORG_A })).toBe(true)
            for (const action of ['create', 'delete', 'manage'] as const) {
                expect(ability.can(action, { type: 'Job', orgId: ORG_A }), action).toBe(false)
            }
        })

        test("a service-key machine reaches no other org's job, and no org-less one", () => {
            const ability = defineAbilitiesFor(machine())
            expect(ability.can('update', { type: 'Job', orgId: ORG_B })).toBe(false)
            expect(ability.can('read', { type: 'Job', orgId: ORG_B })).toBe(false)
            expect(ability.can('update', { type: 'Job', orgId: null })).toBe(false)
        })

        test("the job grant is keel's service-key issuer's alone: an app's machine gets no job power", () => {
            const ability = defineAbilitiesFor(machine({ issuer: 'fixture-intake' }))
            for (const action of ACTIONS) {
                expect(ability.can(action, { type: 'Job', orgId: ORG_A }), action).toBe(false)
            }
        })

        test('every other base subject is denied every action, even in its own org', () => {
            const types = [
                'Membership',
                'Org',
                'User',
                'JobSchedule',
                'WebhookEndpoint',
                'WebhookDelivery',
                'InboundEmail',
                'Notification',
                'NotificationPref',
                'AgreementAcceptance',
            ] as const
            for (const issuer of ['service-key', 'fixture-intake']) {
                const ability = defineAbilitiesFor(machine({ issuer }))
                for (const type of types) {
                    for (const action of ACTIONS) {
                        expect(ability.can(action, { type, orgId: ORG_A }), `${issuer} ${action} ${type}`).toBe(false)
                    }
                }
            }
        })

        test('a machine has no self: a self-only subject owned by its own principal id is still denied', () => {
            const robot = machine()
            const ability = defineAbilitiesFor(robot)
            for (const type of ['User', 'Notification', 'NotificationPref', 'AgreementAcceptance'] as const) {
                for (const action of ACTIONS) {
                    expect(ability.can(action, { type, ownerId: robot.principalId }), `${action} ${type}`).toBe(false)
                }
            }
        })

        test('the staff superpower cannot be smuggled onto a machine', () => {
            // A MachineActor has no manageAll field, so only a cast can put one there; the machine table
            // never reads it. The same grant on a PERSON allows everything (the manageAll suite above).
            const smuggled = { ...machine(), manageAll: true, role: 'admin' } as MachineActor
            const ability = defineAbilitiesFor(smuggled)
            expect(ability.can('manage', { type: 'Membership', orgId: ORG_B })).toBe(false)
            expect(ability.can('create', { type: 'Job', orgId: ORG_A })).toBe(false)
        })

        test("app subjects go to the seam's machine rules, never to the person rules", () => {
            // The fixture's PERSON rule lets any non-restricted member update or delete a docket; its
            // MACHINE rule lets only a `fixture-intake` machine create one. So each answer below shows
            // which table was asked.
            const intake = defineAbilitiesFor(machine({ issuer: 'fixture-intake' }))
            expect(intake.can('create', { type: 'Docket', orgId: ORG_A })).toBe(true)
            expect(intake.can('create', { type: 'Docket', orgId: ORG_B })).toBe(false)
            for (const action of ['read', 'update', 'delete', 'manage'] as const) {
                expect(intake.can(action, { type: 'Docket', orgId: ORG_A }), action).toBe(false)
            }
            const serviceKey = defineAbilitiesFor(machine())
            expect(serviceKey.can('create', { type: 'Docket', orgId: ORG_A })).toBe(false)
        })

        test('cannot is the negation of can for a machine too', () => {
            const ability = defineAbilitiesFor(machine())
            expect(ability.cannot('update', { type: 'Job', orgId: ORG_A })).toBe(false)
            expect(ability.cannot('create', { type: 'Job', orgId: ORG_A })).toBe(true)
        })
    })

    test('principalIdOf records a person by user id and a machine by its issuer-qualified id', () => {
        expect(principalIdOf(actor({ role: 'member', userId: 'user-1' }))).toBe('user-1')
        expect(principalIdOf(machine({ issuer: 'fixture-intake', principalId: 'fixture-intake:crane' }))).toBe(
            'fixture-intake:crane',
        )
    })
})
