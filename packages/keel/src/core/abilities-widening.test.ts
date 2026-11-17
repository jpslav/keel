import { describe, expect, test, vi } from 'vitest'
import { defineAbilitiesFor } from './abilities'

// An app that widened a session-only subject to `inbound-email`. The type forbids it
// (WidenableCredentialKind), so this file reaches it the only way an app could: a cast. The fixture's
// real registration is replaced for this file alone.
vi.mock('@app-config/abilities', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    nonSessionAdministration: { Membership: ['inbound-email', 'fixture-badge'] },
}))

describe('nonSessionAdministration never reaches an inbound email', () => {
    test('an email is refused the subject the app widened to it; a widened badge is not', () => {
        const admin = {
            userId: 'user-1',
            role: 'admin',
            restricted: false,
            activeOrgId: 'org-a',
            manageAll: false,
        } as const
        const viaEmail = defineAbilitiesFor({ ...admin, credential: { kind: 'inbound-email', id: 'email-1' } })
        const viaBadge = defineAbilitiesFor({ ...admin, credential: { kind: 'fixture-badge', id: 'badge-1' } })
        expect(viaEmail.can('create', { type: 'Membership', orgId: 'org-a' })).toBe(false)
        expect(viaBadge.can('create', { type: 'Membership', orgId: 'org-a' })).toBe(true)
    })
})
