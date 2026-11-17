import { describe, expect, test } from 'vitest'
import { canManageOrg, isAssignableRole, isRestricted, isRole, ROLES } from './roles'

describe('roles', () => {
    test('admin and staff manage orgs; others do not', () => {
        expect(canManageOrg('admin')).toBe(true)
        expect(canManageOrg('staff')).toBe(true)
        expect(canManageOrg('member')).toBe(false)
        expect(canManageOrg('guest')).toBe(false)
        expect(canManageOrg('restricted')).toBe(false)
    })

    test('isRole narrows arbitrary strings', () => {
        for (const role of ROLES) expect(isRole(role)).toBe(true)
        expect(isRole('superuser')).toBe(false)
    })

    test('isAssignableRole is every role but admin — what an invite may grant', () => {
        expect(ROLES.filter(isAssignableRole)).toEqual(['staff', 'member', 'guest', 'restricted'])
        expect(isAssignableRole('superuser')).toBe(false)
    })
})

describe('isRestricted', () => {
    test('restricted by the flag, or by the restricted role, and otherwise not', () => {
        expect(isRestricted(true, 'member')).toBe(true)
        expect(isRestricted(false, 'restricted')).toBe(true)
        expect(isRestricted(undefined, 'restricted')).toBe(true)
        expect(isRestricted(false, 'admin')).toBe(false)
        expect(isRestricted(undefined, 'member')).toBe(false)
    })
})
