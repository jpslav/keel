import { describe, expect, test } from 'vitest'
import { type AbilityActor, defineAbilitiesFor } from './abilities'
import type { Role } from './roles'

// Low-entropy, readable fixture ids only (gitleaks): no hex runs, no UUIDs.
const ORG_A = 'org-a'
const ORG_B = 'org-b'

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
})
