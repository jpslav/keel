import { staffOrgSlug } from '@app-config/abilities'
import { describe, expect, test } from 'vitest'
import type { AuthUser } from '../ports/auth'
import { ForbiddenError } from '../ports/errors'
import type { ServiceIdentity } from '../service-auth/verify'
import type { MemberStanding } from '../ports/auth'
import {
    abilityActorFromCredential,
    abilityActorFromService,
    abilityActorFromUser,
    authorize,
    canInActiveOrg,
    machineActor,
} from './authorize'

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
            kind: 'person',
            credential: { kind: 'session', id: null },
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

// The NON-SESSION forms. Fixture vocabulary: `wharf` is the counterparty org whose service key calls,
// `fixture-intake` the one machine credential kind the fixture seam grants an app power to (a Docket create).
const wharfKey: ServiceIdentity = {
    kind: 'org-service',
    keyId: 'key-wharf-1',
    tenantId: 'tenant-harbor',
    tenantSlug: 'harbor',
    orgId: 'org-wharf',
    orgSlug: 'wharf',
}

describe('abilityActorFromService', () => {
    test("is a machine acting in the verified key's org, recorded as service-key:<org slug>, naming its key", () => {
        expect(abilityActorFromService(wharfKey)).toEqual({
            kind: 'machine',
            credential: { kind: 'service-key', id: 'key-wharf-1' },
            principalId: 'service-key:wharf',
            activeOrgId: 'org-wharf',
        })
    })
})

describe('abilityActorFromCredential (a person who arrived without a session)', () => {
    // A stand-in for the auth port's getMember over a world the test edits between calls: it counts
    // reads, so the suite can show the standing is read on EVERY call rather than remembered.
    function world(initial: Record<string, MemberStanding>) {
        const members = new Map(Object.entries(initial))
        let reads = 0
        return {
            members,
            reads: () => reads,
            auth: {
                getMember: async (orgSlug: string, userId: string) => {
                    reads += 1
                    return orgSlug === 'depot' ? (members.get(userId) ?? null) : null
                },
            },
        }
    }
    const depot = { id: 'org-depot', slug: 'depot' }
    const badge = { kind: 'fixture-badge', id: 'badge-7' } as const

    test('is the PERSON, with the standing the auth port reports and the credential that proved them', async () => {
        const w = world({ 'fixture-lead': { role: 'admin', restricted: false } })
        const actor = await abilityActorFromCredential(w.auth, {
            userId: 'fixture-lead',
            org: depot,
            credential: badge,
        })
        expect(actor).toEqual({
            kind: 'person',
            credential: badge,
            userId: 'fixture-lead',
            role: 'admin',
            restricted: false,
            activeOrgId: 'org-depot',
            manageAll: false,
        })
    })

    test('a person removed from the org has no actor on the very next call: their credential is dead', async () => {
        const w = world({ 'fixture-lead': { role: 'admin', restricted: false } })
        const input = { userId: 'fixture-lead', org: depot, credential: badge }
        const before = await abilityActorFromCredential(w.auth, input)
        expect(() => authorize(before!, 'create', { type: 'Docket', orgId: 'org-depot' })).not.toThrow()

        w.members.delete('fixture-lead')
        expect(await abilityActorFromCredential(w.auth, input)).toBeNull()
        expect(w.reads()).toBe(2)
    })

    test('a demotion takes effect on the next call (nothing is cached in, or derived from, the credential)', async () => {
        const w = world({ 'fixture-lead': { role: 'admin', restricted: false } })
        const input = { userId: 'fixture-lead', org: depot, credential: badge }
        const asAdmin = await abilityActorFromCredential(w.auth, input)
        expect(() => authorize(asAdmin!, 'create', { type: 'Membership', orgId: 'org-depot' })).not.toThrow()

        w.members.set('fixture-lead', { role: 'member', restricted: true })
        const demoted = await abilityActorFromCredential(w.auth, input)
        expect(() => authorize(demoted!, 'create', { type: 'Membership', orgId: 'org-depot' })).toThrow(ForbiddenError)
        expect(() => authorize(demoted!, 'create', { type: 'Docket', orgId: 'org-depot' })).toThrow(ForbiddenError)
    })

    test('a member of ANOTHER org is no member here', async () => {
        const w = world({ 'fixture-lead': { role: 'admin', restricted: false } })
        const annex = { id: 'org-annex', slug: 'annex' }
        expect(
            await abilityActorFromCredential(w.auth, { userId: 'fixture-lead', org: annex, credential: badge }),
        ).toBeNull()
    })

    test('refuses to build from a session credential (a cast, or an app kind named `session`)', async () => {
        const w = world({ 'fixture-lead': { role: 'admin', restricted: false } })
        const session = { kind: 'session', id: 'x' } as unknown as typeof badge
        await expect(
            abilityActorFromCredential(w.auth, { userId: 'fixture-lead', org: depot, credential: session }),
        ).rejects.toThrow(/session/)
        expect(w.reads()).toBe(0)
    })

    test('never wields the staff superpower, even acting in the staff org', async () => {
        const w = world({})
        const steward = { id: 'org-steward', slug: staffOrgSlug }
        w.auth.getMember = async () => ({ role: 'admin', restricted: false })
        const actor = await abilityActorFromCredential(w.auth, {
            userId: 'fixture-lead',
            org: steward,
            credential: badge,
        })
        expect(actor?.manageAll).toBe(false)
        expect(() => authorize(actor!, 'manage', { type: 'Membership', orgId: 'org-depot' })).toThrow(ForbiddenError)
    })
})

describe('machineActor', () => {
    test('qualifies the id by its credential kind and names the credential it presented', () => {
        const actor = machineActor({
            kind: 'fixture-intake',
            id: 'crane/7',
            credentialId: 'run-42',
            activeOrgId: 'org-depot',
        })
        expect(actor).toEqual({
            kind: 'machine',
            credential: { kind: 'fixture-intake', id: 'run-42' },
            principalId: 'fixture-intake:crane/7',
            activeOrgId: 'org-depot',
        })
        expect(machineActor({ kind: 'fixture-intake', id: 'crane', activeOrgId: 'org-depot' }).credential.id).toBeNull()
    })

    // The kind is typed to the app's machine kinds, so the bad values below are casts: they stand for an
    // app that REGISTERED a reserved or malformed kind, which the composed union cannot refuse.
    test("refuses keel's own kinds, so an app machine cannot pass for a service key, a person or a system writer", () => {
        for (const kind of ['service-key', 'session', 'inbound-email', 'system']) {
            expect(
                () => machineActor({ kind: kind as 'fixture-intake', id: 'x', activeOrgId: 'org-depot' }),
                kind,
            ).toThrow(/reserved/)
        }
    })

    test('refuses a kind that is not a lowercase slug (a `:` would make principal ids ambiguous)', () => {
        for (const kind of ['', 'Fixture', 'fixture:intake', 'fixture intake', '-fixture']) {
            expect(
                () => machineActor({ kind: kind as 'fixture-intake', id: 'x', activeOrgId: 'org-depot' }),
                kind,
            ).toThrow(/lowercase slug/)
        }
    })

    test('refuses an empty id or org (a programming error, never a 403)', () => {
        expect(() => machineActor({ kind: 'fixture-intake', id: '', activeOrgId: 'org-depot' })).toThrow(Error)
        expect(() => machineActor({ kind: 'fixture-intake', id: 'x', activeOrgId: '' })).toThrow(Error)
        expect(() => machineActor({ kind: 'fixture-intake', id: '', activeOrgId: 'org-depot' })).not.toThrow(
            ForbiddenError,
        )
    })
})

/** Whether an authorize call allows (no throw) or denies (ForbiddenError); anything else propagates. */
function allowed(call: () => void): boolean {
    try {
        call()
        return true
    } catch (error) {
        if (error instanceof ForbiddenError) return false
        throw error
    }
}

describe('authorize(actor, action, subject)', () => {
    test("a service caller may report status on its own org's job", () => {
        const actor = abilityActorFromService(wharfKey)
        expect(() => authorize(actor, 'update', { type: 'Job', orgId: 'org-wharf' })).not.toThrow()
    })

    test("a service caller is refused another org's job, with the usual message", () => {
        const actor = abilityActorFromService(wharfKey)
        expect(() => authorize(actor, 'update', { type: 'Job', orgId: 'org-depot' })).toThrow('cannot update Job')
    })

    test('a machine is refused what only people may do, in its own org', () => {
        const actor = abilityActorFromService(wharfKey)
        expect(() => authorize(actor, 'create', { type: 'Membership', orgId: 'org-wharf' })).toThrow(ForbiddenError)
        expect(() => authorize(actor, 'create', { type: 'Job', orgId: 'org-wharf' })).toThrow(ForbiddenError)
    })

    test("an app machine gets exactly what the seam's machine rules grant", () => {
        const intake = machineActor({ kind: 'fixture-intake', id: 'crane', activeOrgId: 'org-depot' })
        expect(() => authorize(intake, 'create', { type: 'Docket', orgId: 'org-depot' })).not.toThrow()
        expect(() => authorize(intake, 'update', { type: 'Docket', orgId: 'org-depot' })).toThrow(ForbiddenError)
        expect(() => authorize(intake, 'update', { type: 'Job', orgId: 'org-depot' })).toThrow(ForbiddenError)
    })

    test('a person holding a non-session credential is judged as their session would be, outside the staff org', () => {
        // The token's owner as abilityActorFromCredential builds them: the badge is the fixture's
        // personal-token shape. Ordinary rules answer exactly as for the same person's session.
        const owner = {
            kind: 'person',
            credential: { kind: 'fixture-badge', id: 'badge-7' },
            userId: 'user-1',
            role: 'member',
            restricted: false,
            activeOrgId: 'org-a',
            manageAll: false,
        } as const
        for (const subject of [
            { type: 'Job', orgId: 'org-a' },
            { type: 'Membership', orgId: 'org-a' },
            { type: 'Job', orgId: 'org-b' },
        ] as const) {
            expect(
                allowed(() => authorize(owner, 'create', subject)),
                `${subject.type} in ${subject.orgId}`,
            ).toBe(allowed(() => authorize(user({ role: 'member' }), 'org-a', 'create', subject)))
        }
        expect(allowed(() => authorize(owner, 'create', { type: 'Job', orgId: 'org-a' }))).toBe(true)
        expect(allowed(() => authorize(owner, 'create', { type: 'Membership', orgId: 'org-a' }))).toBe(false)
    })

    test('...and differs from the session in exactly one place: acting in the staff org, only the session wields manage-all', () => {
        const foreign = { type: 'Membership', orgId: 'org-c' } as const
        const session = user({ orgSlug: staffOrgSlug, role: 'admin' })
        expect(allowed(() => authorize(session, 'org-staff', 'manage', foreign))).toBe(true)

        // Even an actor that CLAIMS manageAll is denied when its credential is not a session, or unstated.
        const asSession = abilityActorFromUser(session, 'org-staff')
        const viaBadge = { ...asSession, credential: { kind: 'fixture-badge', id: 'badge-7' } } as const
        const unstated = { ...asSession, credential: undefined }
        expect(asSession.manageAll).toBe(true)
        expect(allowed(() => authorize(viaBadge, 'manage', foreign))).toBe(false)
        expect(allowed(() => authorize(unstated, 'manage', foreign))).toBe(false)
    })
})
