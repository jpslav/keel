import { describe, expect, test } from 'vitest'
import { type AbilityActor, defineAbilitiesFor } from 'keel/core/abilities'
import type { Role } from 'keel/core/roles'

// The APP's subject rules (Ticket, Attachment, Escalation), exercised through the composed
// defineAbilitiesFor — proving the framework `default:` delegation to appAbilityRules holds
// (ADR-0012). Framework base subjects are covered in packages/keel/src/core/abilities.test.ts.

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

describe('app ability rules (via defineAbilitiesFor)', () => {
    describe('Ticket', () => {
        test('a member may create/read/update/delete tickets in their active org', () => {
            const ability = defineAbilitiesFor(actor({ role: 'member' }))
            for (const action of ['create', 'read', 'update', 'delete'] as const) {
                expect(ability.can(action, { type: 'Ticket', orgId: ORG_A })).toBe(true)
            }
        })

        test('a restricted member may READ but not create/update/delete tickets (the demoable denial)', () => {
            const ability = defineAbilitiesFor(actor({ role: 'restricted', restricted: true }))
            expect(ability.can('read', { type: 'Ticket', orgId: ORG_A })).toBe(true)
            expect(ability.can('create', { type: 'Ticket', orgId: ORG_A })).toBe(false)
            expect(ability.can('update', { type: 'Ticket', orgId: ORG_A })).toBe(false)
            expect(ability.can('delete', { type: 'Ticket', orgId: ORG_A })).toBe(false)
        })

        test('the restricted flag denies create even for an otherwise-privileged role', () => {
            const ability = defineAbilitiesFor(actor({ role: 'admin', restricted: true }))
            expect(ability.can('create', { type: 'Ticket', orgId: ORG_A })).toBe(false)
        })

        test('no ticket action reaches another org', () => {
            const ability = defineAbilitiesFor(actor({ role: 'member', activeOrgId: ORG_A }))
            for (const action of ['create', 'read', 'update', 'delete'] as const) {
                expect(ability.can(action, { type: 'Ticket', orgId: ORG_B })).toBe(false)
            }
        })

        test('a ticket with no org (null/absent) is never in-scope', () => {
            const ability = defineAbilitiesFor(actor({ role: 'admin' }))
            expect(ability.can('read', { type: 'Ticket', orgId: null })).toBe(false)
            expect(ability.can('read', { type: 'Ticket' })).toBe(false)
        })
    })

    describe('Attachment', () => {
        test('a member may create/read/delete attachments in their active org', () => {
            const ability = defineAbilitiesFor(actor({ role: 'member' }))
            for (const action of ['create', 'read', 'delete'] as const) {
                expect(ability.can(action, { type: 'Attachment', orgId: ORG_A })).toBe(true)
            }
        })

        test('a restricted member may READ but not create/delete attachments (the demoable denial)', () => {
            const ability = defineAbilitiesFor(actor({ role: 'restricted', restricted: true }))
            expect(ability.can('read', { type: 'Attachment', orgId: ORG_A })).toBe(true)
            expect(ability.can('create', { type: 'Attachment', orgId: ORG_A })).toBe(false)
            expect(ability.can('delete', { type: 'Attachment', orgId: ORG_A })).toBe(false)
        })

        test('attachments have no update/manage rule (confirm re-uses create; no edit)', () => {
            const ability = defineAbilitiesFor(actor({ role: 'admin' }))
            for (const action of ['update', 'manage'] as const) {
                expect(ability.can(action, { type: 'Attachment', orgId: ORG_A })).toBe(false)
            }
        })

        test('no attachment action reaches another org, and a null org is never in-scope', () => {
            const ability = defineAbilitiesFor(actor({ role: 'admin', activeOrgId: ORG_A }))
            for (const action of ['create', 'read', 'delete'] as const) {
                expect(ability.can(action, { type: 'Attachment', orgId: ORG_B })).toBe(false)
            }
            expect(ability.can('read', { type: 'Attachment', orgId: null })).toBe(false)
        })
    })

    describe('Escalation (two-sided escalation)', () => {
        // The actor acts in ORG_A. "sent" = ORG_A is the requester; "received" = ORG_A is the responder.
        const sent = { type: 'Escalation', requesterOrgId: ORG_A, responderOrgId: ORG_B } as const
        const received = { type: 'Escalation', requesterOrgId: ORG_B, responderOrgId: ORG_A } as const

        test('the requester side may create (raise) and delete (withdraw) when not restricted', () => {
            const ability = defineAbilitiesFor(actor({ role: 'member' }))
            expect(ability.can('create', sent)).toBe(true)
            expect(ability.can('delete', sent)).toBe(true)
        })

        test('a restricted member on the requester side may NOT create or delete (but may still read)', () => {
            const ability = defineAbilitiesFor(actor({ role: 'restricted', restricted: true }))
            expect(ability.can('read', sent)).toBe(true)
            expect(ability.can('create', sent)).toBe(false)
            expect(ability.can('delete', sent)).toBe(false)
        })

        test('both sides may read the request', () => {
            const requester = defineAbilitiesFor(actor({ role: 'member' }))
            const responder = defineAbilitiesFor(actor({ role: 'member' }))
            expect(requester.can('read', sent)).toBe(true)
            expect(responder.can('read', received)).toBe(true)
        })

        test('only an org manager on the RESPONDER side may respond (update)', () => {
            for (const role of ['admin', 'staff'] as const) {
                const manager = defineAbilitiesFor(actor({ role }))
                expect(manager.can('update', received)).toBe(true)
            }
            // A plain member on the responder side may read but not respond (the demoable asymmetry:
            // Sam, an outreach member, sees the request but can't accept/reject it).
            const member = defineAbilitiesFor(actor({ role: 'member' }))
            expect(member.can('read', received)).toBe(true)
            expect(member.can('update', received)).toBe(false)
        })

        test('a RESTRICTED manager on the responder side may still respond (restricted reduces authoring, never management authority)', () => {
            // The house rule: `restricted` never strips manager powers. Pinned here so a
            // future "fix" to `!restricted && canManageOrg` reads as a deliberate product change.
            const restrictedManager = defineAbilitiesFor(actor({ role: 'admin', restricted: true }))
            expect(restrictedManager.can('update', received)).toBe(true)
        })

        test('the requester side may NOT respond even as a manager (respond is responder-only)', () => {
            const manager = defineAbilitiesFor(actor({ role: 'admin' }))
            expect(manager.can('update', sent)).toBe(false)
        })

        test('the responder side may NOT create/delete the request (raise/withdraw is requester-only)', () => {
            const manager = defineAbilitiesFor(actor({ role: 'admin' }))
            expect(manager.can('create', received)).toBe(false)
            expect(manager.can('delete', received)).toBe(false)
        })

        test('manage is never granted on a request', () => {
            const manager = defineAbilitiesFor(actor({ role: 'admin' }))
            expect(manager.can('manage', sent)).toBe(false)
            expect(manager.can('manage', received)).toBe(false)
        })

        test('a bystander org (neither side) is denied every action', () => {
            const bystander = defineAbilitiesFor(actor({ role: 'admin', activeOrgId: ORG_A }))
            const foreign = { type: 'Escalation', requesterOrgId: ORG_B, responderOrgId: 'org-c' } as const
            for (const action of ['read', 'create', 'update', 'delete', 'manage'] as const) {
                expect(bystander.can(action, foreign)).toBe(false)
            }
        })

        test('a request with a null side never matches that side', () => {
            const ability = defineAbilitiesFor(actor({ role: 'admin' }))
            // requester null → cannot create; responder null → cannot respond even as manager.
            expect(ability.can('create', { type: 'Escalation', requesterOrgId: null, responderOrgId: ORG_B })).toBe(
                false,
            )
            expect(ability.can('update', { type: 'Escalation', requesterOrgId: ORG_B, responderOrgId: null })).toBe(
                false,
            )
            // both null → not even readable
            expect(ability.can('read', { type: 'Escalation', requesterOrgId: null, responderOrgId: null })).toBe(false)
        })

        test('manageAll short-circuits requests too', () => {
            const god = defineAbilitiesFor(actor({ role: 'restricted', restricted: true, manageAll: true }))
            expect(god.can('update', { type: 'Escalation', requesterOrgId: ORG_B, responderOrgId: 'org-c' })).toBe(true)
        })
    })
})
