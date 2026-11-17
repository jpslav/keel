import { describe, expect, test } from 'vitest'
import {
    type AbilityActor,
    type MachineActor,
    type MachineCredentialKind,
    defineAbilitiesFor,
    principalIdOf,
} from './abilities'
import type { Role } from './roles'

// Low-entropy, readable fixture ids only (gitleaks): no hex runs, no UUIDs.
const ORG_A = 'org-a'
const ORG_B = 'org-b'

function machine(kind: MachineCredentialKind = 'service-key', overrides: Partial<MachineActor> = {}): MachineActor {
    return {
        kind: 'machine',
        credential: { kind, id: 'key-1' },
        principalId: `${kind}:wharf`,
        activeOrgId: ORG_A,
        ...overrides,
    }
}

const ACTIONS = ['create', 'read', 'update', 'delete', 'manage'] as const

/**
 * A person actor; a SESSION unless the test says otherwise, since that is what the person rules assume.
 * It takes any fields and CASTS, so a test can also build the shapes the type forbids (a possibly-true
 * `manageAll` with no session credential) and prove the run time refuses them as well.
 */
function actor(overrides: { role: Role; [field: string]: unknown }): AbilityActor {
    return {
        credential: { kind: 'session', id: null },
        userId: 'user-1',
        restricted: false,
        activeOrgId: ORG_A,
        manageAll: false,
        ...overrides,
    } as AbilityActor
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

    test('a value that is not a well-formed person is denied everything, rather than judged as one', () => {
        // A machine that lost its `kind` (a cast, a value rehydrated from storage): judged as a person it
        // had no role and an undefined `restricted`, and `!restricted` let it update dockets and create jobs.
        const lostKind = {
            credential: { kind: 'service-key', id: 'key-1' },
            principalId: 'service-key:wharf',
            activeOrgId: ORG_A,
        } as unknown as AbilityActor
        const asLost = defineAbilitiesFor(lostKind)
        expect(asLost.can('update', { type: 'Docket', orgId: ORG_A })).toBe(false)
        expect(asLost.can('create', { type: 'Job', orgId: ORG_A })).toBe(false)
        // ...and so is a person with a role the ladder does not have, or a `restricted` that is not a boolean.
        for (const malformed of [actor({ role: 'owner' as Role }), actor({ role: 'member', restricted: 'no' })]) {
            expect(defineAbilitiesFor(malformed).can('create', { type: 'Job', orgId: ORG_A })).toBe(false)
        }
        expect(defineAbilitiesFor(actor({ role: 'member' })).can('create', { type: 'Job', orgId: ORG_A })).toBe(true)
    })

    // A PERSON who came through a credential other than a session (an inbound email, a personal token):
    // the same rules as a session, except that the staff superpower is a session's alone.
    describe('a person with a non-session credential', () => {
        const badge = { kind: 'fixture-badge', id: 'badge-1' } as const

        test('is judged by the same person rules as a session', () => {
            const ability = defineAbilitiesFor(actor({ role: 'member', credential: badge }))
            expect(ability.can('create', { type: 'Job', orgId: ORG_A })).toBe(true)
            expect(ability.can('create', { type: 'Membership', orgId: ORG_A })).toBe(false)
            expect(ability.can('update', { type: 'User', ownerId: 'user-1' })).toBe(true)
        })

        test("never wields manageAll, whatever the actor says: it is a STATED session's power, enforced here", () => {
            for (const credential of [badge, { kind: 'inbound-email', id: 'email-1' }] as const) {
                const ability = defineAbilitiesFor(actor({ role: 'admin', manageAll: true, credential }))
                expect(ability.can('manage', { type: 'Membership', orgId: ORG_B }), credential.kind).toBe(false)
                expect(ability.can('update', { type: 'User', ownerId: 'user-2' }), credential.kind).toBe(false)
            }
            // A literal that states NO credential is not read as a session either.
            const unstated = defineAbilitiesFor(actor({ role: 'admin', manageAll: true, credential: undefined }))
            expect(unstated.can('manage', { type: 'Membership', orgId: ORG_B })).toBe(false)
            // The control: the same actor stating a session credential does wield it.
            const session = defineAbilitiesFor(
                actor({ role: 'admin', manageAll: true, credential: { kind: 'session', id: null } }),
            )
            expect(session.can('manage', { type: 'Membership', orgId: ORG_B })).toBe(true)
        })

        test("the app's rules see the credential kind, which is where narrowing by kind lives", () => {
            // The fixture's Docket rule: delete takes a session; a badge may file and edit, not remove.
            const viaBadge = defineAbilitiesFor(actor({ role: 'member', credential: badge }))
            const viaSession = defineAbilitiesFor(actor({ role: 'member', credential: { kind: 'session', id: null } }))
            expect(viaBadge.can('create', { type: 'Docket', orgId: ORG_A })).toBe(true)
            expect(viaBadge.can('delete', { type: 'Docket', orgId: ORG_A })).toBe(false)
            expect(viaSession.can('delete', { type: 'Docket', orgId: ORG_A })).toBe(true)
        })
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

        test("the job grant is keel's service keys' alone: an app's machine gets no job power", () => {
            const ability = defineAbilitiesFor(machine('fixture-intake'))
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
            for (const kind of ['service-key', 'fixture-intake'] as const) {
                const ability = defineAbilitiesFor(machine(kind))
                for (const type of types) {
                    for (const action of ACTIONS) {
                        expect(ability.can(action, { type, orgId: ORG_A }), `${kind} ${action} ${type}`).toBe(false)
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
            const intake = defineAbilitiesFor(machine('fixture-intake'))
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

    test('principalIdOf records a person by user id and a machine by its kind-qualified id', () => {
        expect(principalIdOf(actor({ role: 'member', userId: 'user-1' }))).toBe('user-1')
        expect(principalIdOf(machine('fixture-intake', { principalId: 'fixture-intake:crane' }))).toBe(
            'fixture-intake:crane',
        )
    })
})
