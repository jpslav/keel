import { describe, expect, test } from 'vitest'
import { authorize, canInActiveOrg } from 'keel/authz/authorize'
import type { AuthUser } from 'keel/ports/auth'
import { ForbiddenError } from 'keel/ports/errors'

// The authz choke point (packages/keel/src/authz/authorize.ts) enforcing the APP's registered subjects (Ticket,
// Escalation). The choke point is framework; these cases prove it composes the app rules the seam
// registers (src/app-config/abilities.ts). Framework-subject enforcement lives in
// packages/keel/src/authz/authorize.test.ts.

function user(overrides: Partial<AuthUser> = {}): AuthUser {
    return {
        id: 'user-1',
        name: 'Member One',
        email: 'member.one@example.test',
        role: 'member',
        locale: 'en',
        tenantSlug: 'tenant-a',
        orgSlug: 'team-a',
        restricted: false,
        ...overrides,
    }
}

describe('authorize (app subjects)', () => {
    test('returns void when a member opens a ticket in their active org', () => {
        expect(() => authorize(user(), 'org-a', 'create', { type: 'Ticket', orgId: 'org-a' })).not.toThrow()
    })

    test('a restricted member is denied ticket create with a named ForbiddenError', () => {
        const restricted = user({ role: 'restricted', restricted: true })
        expect(() => authorize(restricted, 'org-a', 'create', { type: 'Ticket', orgId: 'org-a' })).toThrow(
            'cannot create Ticket',
        )
    })

    test('denies a ticket whose org differs from the passed active org', () => {
        expect(() => authorize(user(), 'org-a', 'create', { type: 'Ticket', orgId: 'org-b' })).toThrow(ForbiddenError)
    })

    // Escalation is enforced with the row's REAL org ids (never the slug anchor) — the requester acts
    // in org-a, the responder in org-b.
    const request = { type: 'Escalation', requesterOrgId: 'org-a', responderOrgId: 'org-b' } as const

    test('the requester side may create an escalation', () => {
        expect(() => authorize(user({ role: 'member' }), 'org-a', 'create', request)).not.toThrow()
    })

    test('a restricted requester is denied create', () => {
        const restricted = user({ role: 'restricted', restricted: true })
        expect(() => authorize(restricted, 'org-a', 'create', request)).toThrow(ForbiddenError)
    })

    test('a non-manager on the responder side is denied respond (update)', () => {
        // Sam acts in org-b (the responder) as a plain member — reads yes, responds no.
        expect(() => authorize(user({ role: 'member' }), 'org-b', 'update', request)).toThrow(ForbiddenError)
    })

    test('a manager on the responder side may respond (update)', () => {
        expect(() => authorize(user({ role: 'staff' }), 'org-b', 'update', request)).not.toThrow()
    })

    test('the requester side is denied respond even as a manager', () => {
        expect(() => authorize(user({ role: 'admin' }), 'org-a', 'update', request)).toThrow(ForbiddenError)
    })

    test('a bystander org (neither side) is denied read', () => {
        expect(() => authorize(user({ role: 'admin' }), 'org-c', 'read', request)).toThrow(ForbiddenError)
    })
})

describe('canInActiveOrg (app subjects)', () => {
    test('true for a member creating a ticket in their active org (no orgId lookup needed)', () => {
        expect(canInActiveOrg(user({ role: 'member' }), 'create', 'Ticket')).toBe(true)
    })

    test('false for a restricted member creating a ticket (parity with authorize deny)', () => {
        expect(canInActiveOrg(user({ role: 'restricted', restricted: true }), 'create', 'Ticket')).toBe(false)
    })

    test('true for reading a ticket in the active org regardless of restriction', () => {
        expect(canInActiveOrg(user({ role: 'restricted', restricted: true }), 'read', 'Ticket')).toBe(true)
    })

    test('the slug anchor stands in for both request sides: a member may create, a manager may respond', () => {
        // create-gate reads as "am I the requester" — any non-restricted member qualifies.
        expect(canInActiveOrg(user({ role: 'member' }), 'create', 'Escalation')).toBe(true)
        expect(canInActiveOrg(user({ role: 'restricted', restricted: true }), 'create', 'Escalation')).toBe(false)
        // update-gate reads as "am I the responder" — only an org manager qualifies.
        expect(canInActiveOrg(user({ role: 'admin' }), 'update', 'Escalation')).toBe(true)
        expect(canInActiveOrg(user({ role: 'member' }), 'update', 'Escalation')).toBe(false)
    })
})
