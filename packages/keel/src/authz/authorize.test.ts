import { staffOrgSlug } from '@app-config/abilities'
import { describe, expect, test } from 'vitest'
import type { AuthUser } from '../ports/auth'
import { ForbiddenError } from '../ports/errors'
import { abilityActorFromUser, authorize, canInActiveOrg } from './authorize'

// This suite covers the authz choke point over FRAMEWORK subjects (Job, Membership) and the staff
// manage-all mechanism. The choke point's enforcement of an APP's own subjects is exercised app-side,
// in each app's src/app-config/authorize.test.ts — the seam that registers them (ADR-0012).
//
// `staffOrgSlug` is IMPORTED from the seam rather than written as a literal, so this file asserts on
// whatever the seam says the operator org is (`steward` under the fixture) and the two cannot drift.

// Low-entropy, readable fixture ids/slugs only (gitleaks): no hex, no UUIDs, no token-like values.
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

describe('abilityActorFromUser', () => {
    test('maps the AuthUser fields; manageAll is false when NOT acting in the staff org', () => {
        // The default fixture's active org is 'team-a', not the staff org, so manageAll stays off.
        const actor = abilityActorFromUser(user({ role: 'admin', restricted: true }), 'org-a')
        expect(actor).toEqual({
            userId: 'user-1',
            role: 'admin',
            restricted: true,
            activeOrgId: 'org-a',
            manageAll: false,
        })
    })

    test('manageAll is true when the ACTIVE org is the staff org (activation by wielding)', () => {
        const actor = abilityActorFromUser(user({ role: 'admin', orgSlug: staffOrgSlug }), 'org-staff')
        expect(actor.manageAll).toBe(true)
    })

    test('activation is by ACTIVE org, not rank — even a plain member acting AS the staff org wields it', () => {
        const actor = abilityActorFromUser(user({ role: 'member', orgSlug: staffOrgSlug }), 'org-staff')
        expect(actor.manageAll).toBe(true)
    })
})

describe('staff manage-all', () => {
    // Managing a membership in org-c — a foreign org the actor is not acting in. Only the staff-org
    // superpower (manageAll) can reach it; an ordinary admin cannot (not sameOrg).
    const foreign = { type: 'Membership', orgId: 'org-c' } as const

    test('acting in the staff org authorizes an action the actor would otherwise be denied', () => {
        const olive = user({ orgSlug: staffOrgSlug, role: 'admin' })
        expect(() => authorize(olive, 'org-staff', 'manage', foreign)).not.toThrow()
    })

    test('the SAME actor in a non-staff active org has no such power (activation is by wielding)', () => {
        // Not acting in the staff org → the ordinary sameOrg rule applies → denied (foreign org).
        expect(() => authorize(user({ orgSlug: 'org-a', role: 'admin' }), 'org-a', 'manage', foreign)).toThrow(
            ForbiddenError,
        )
    })

    test('a staff-org actor can do everything IN-APP via canInActiveOrg (manage-all in the active org)', () => {
        const olive = user({ orgSlug: staffOrgSlug, role: 'admin' })
        expect(canInActiveOrg(olive, 'create', 'Job')).toBe(true)
        expect(canInActiveOrg(olive, 'manage', 'Org')).toBe(true)
    })
})

describe('authorize', () => {
    test('returns void (does not throw) when the action is allowed', () => {
        expect(() => authorize(user(), 'org-a', 'create', { type: 'Job', orgId: 'org-a' })).not.toThrow()
    })

    test('throws ForbiddenError when the action is denied', () => {
        const restricted = user({ role: 'restricted', restricted: true })
        expect(() => authorize(restricted, 'org-a', 'create', { type: 'Job', orgId: 'org-a' })).toThrow(ForbiddenError)
    })

    test('the ForbiddenError message names the action and subject', () => {
        const restricted = user({ role: 'restricted', restricted: true })
        expect(() => authorize(restricted, 'org-a', 'create', { type: 'Job', orgId: 'org-a' })).toThrow(
            'cannot create Job',
        )
    })

    test('denies when the subject org differs from the passed active org', () => {
        expect(() => authorize(user(), 'org-a', 'create', { type: 'Job', orgId: 'org-b' })).toThrow(ForbiddenError)
    })

    test('a non-manager cannot create a Membership (the org/invite 403 path)', () => {
        expect(() =>
            authorize(user({ role: 'member' }), 'org-a', 'create', { type: 'Membership', orgId: 'org-a' }),
        ).toThrow(ForbiddenError)
    })

    test('a manager may create a Membership', () => {
        expect(() =>
            authorize(user({ role: 'staff' }), 'org-a', 'create', { type: 'Membership', orgId: 'org-a' }),
        ).not.toThrow()
    })
})

describe('canInActiveOrg', () => {
    test('true for a member creating a job in their active org (no orgId lookup needed)', () => {
        expect(canInActiveOrg(user({ role: 'member' }), 'create', 'Job')).toBe(true)
    })

    test('false for a restricted member creating a job (parity with authorize deny)', () => {
        expect(canInActiveOrg(user({ role: 'restricted', restricted: true }), 'create', 'Job')).toBe(false)
    })

    test('true for reading a job in the active org regardless of restriction', () => {
        expect(canInActiveOrg(user({ role: 'restricted', restricted: true }), 'read', 'Job')).toBe(true)
    })

    test('managership gates Membership create the same way', () => {
        expect(canInActiveOrg(user({ role: 'admin' }), 'create', 'Membership')).toBe(true)
        expect(canInActiveOrg(user({ role: 'member' }), 'create', 'Membership')).toBe(false)
    })
})
