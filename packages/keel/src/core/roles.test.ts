import { describe, expect, test } from 'vitest'
import { canManageOrg, isRole, ROLES } from './roles'

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
})
