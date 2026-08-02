import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { APP_SLUG } from '@app-config/identity'
import { findOrg, people, type SeedPerson } from '@app-config/seed'
import { jwtVerify, SignJWT } from 'jose'
import { cookies } from 'next/headers'
import { LOCALES, type Locale } from '../../core/locale'
import { isRole, type Role } from '../../core/roles'
import type { AuthPort, AuthUser, InviteInput, Membership, OrgRef, ProfileUpdate } from '../../ports/auth'
import { AuthRequiredError, ForbiddenError } from '../../ports/errors'
import { writeFileAtomicSync, writeJsonAtomic } from './atomic-write'
import { readSimulatorState, updatePersonState, writeViewpointCookie } from './simulator'
import { dataDir } from './data-dir'

const COOKIE_NAME = `${APP_SLUG}_session`
const ISSUER = `${APP_SLUG}-fake-auth`

/** Stable per-checkout signing secret so dev sessions survive restarts. Never used in real mode. */
function secret(): Uint8Array {
    const file = path.join(dataDir('auth'), 'dev-secret')
    if (!existsSync(file)) writeFileAtomicSync(file, randomBytes(32).toString('hex'), { mode: 0o600 })
    return new TextEncoder().encode(readFileSync(file, 'utf8'))
}

interface ProfileOverride {
    name?: string
    locale?: Locale
}

function overridesFile(): string {
    return path.join(dataDir('auth'), 'profile-overrides.json')
}

function readOverrides(): Record<string, ProfileOverride> {
    const file = overridesFile()
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, ProfileOverride>) : {}
}

export interface StoredInvite {
    id: string
    email: string
    role: Role
    orgSlug: string
    invitedAt: string
}

function invitesFile(): string {
    return path.join(dataDir('auth'), 'invites.json')
}

export function readInvites(): StoredInvite[] {
    const file = invitesFile()
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as StoredInvite[]) : []
}

/** Simulated-mode-only lookup used by the Simulator APIs and the accept-invite page (NOT part of AuthPort). */
export function findInvite(id: string): StoredInvite | undefined {
    return readInvites().find((invite) => invite.id === id)
}

function peopleFile(): string {
    return path.join(dataDir('auth'), 'people.json')
}

/**
 * Overlay of people created by acceptInvite (simulated-mode-only, NOT part of AuthPort): every seed
 * person is static, but an accepted invite needs somewhere durable to live across restarts, so
 * this is the same read-a-JSON-array-or-default-empty pattern as invites.json.
 */
function listDynamicPeople(): SeedPerson[] {
    const file = peopleFile()
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as SeedPerson[]) : []
}

/** Seed + dynamic people as one list — the sign-in picker, Simulator People, and every person
 *  lookup below all need "everyone who can sign in", not just the static seed. */
export function listAllPeople(): SeedPerson[] {
    return [...people, ...listDynamicPeople()]
}

function findPerson(id: string | undefined): SeedPerson | undefined {
    return id ? listAllPeople().find((p) => p.id === id) : undefined
}

/**
 * Simulated-mode-only locale lookup (NOT part of AuthPort) — the notification fan-out's `resolveLocale`
 * enrichment, so a recipient's email/SMS render in their language (the digest-email locale precedent).
 * Honours a profile-override locale first, then the person's seed locale; undefined for an unknown id
 * (the fan-out then falls back to the app default). Real mode has no analog (Clerk memberships carry no
 * locale), so this stays fake-only and behind the fan-out's optional dependency.
 */
export function personLocale(userId: string): Locale | undefined {
    const person = findPerson(userId)
    if (!person) return undefined
    return readOverrides()[person.id]?.locale ?? person.locale
}

/**
 * Resolve the person's membership for `activeOrgSlug`, falling back to their first membership when
 * the slug isn't (or is no longer) one they belong to. People always have ≥1 membership, so this
 * never returns undefined for a valid person.
 */
function resolveMembership(person: SeedPerson, activeOrgSlug: string) {
    return person.memberships.find((m) => m.orgSlug === activeOrgSlug) ?? person.memberships[0]
}

function toUser(person: SeedPerson, activeOrgSlug: string): AuthUser {
    const override = readOverrides()[person.id] ?? {}
    const membership = resolveMembership(person, activeOrgSlug)
    return {
        id: person.id,
        name: override.name ?? person.name,
        email: person.email,
        role: membership.role,
        locale: override.locale ?? person.locale,
        // Ambient site: a person's tenant is fixed, never the active org's business.
        tenantSlug: person.tenantSlug,
        orgSlug: membership.orgSlug,
        restricted: person.restricted,
    }
}

/** The orgs a person belongs to, each with its per-org role — drives the OrgSwitcher. */
function orgsForPerson(person: SeedPerson): OrgRef[] {
    return person.memberships.flatMap((m) => {
        const org = findOrg(m.orgSlug)
        return org ? [{ slug: org.slug, name: org.name, role: m.role }] : []
    })
}

async function readSession(): Promise<{ person: SeedPerson; orgSlug: string } | null> {
    const jar = await cookies()
    const token = jar.get(COOKIE_NAME)?.value
    if (!token) return null
    try {
        const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER })
        const person = findPerson(payload.sub)
        if (!person) return null
        const claimed = typeof payload.org === 'string' ? payload.org : undefined
        // A stale/foreign org claim must not stick — fall back to the first membership.
        const orgSlug =
            claimed && person.memberships.some((m) => m.orgSlug === claimed) ? claimed : person.memberships[0].orgSlug
        return { person, orgSlug }
    } catch {
        return null
    }
}

async function writeSession(personId: string, orgSlug: string): Promise<void> {
    const token = await new SignJWT({ org: orgSlug })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(personId)
        .setIssuer(ISSUER)
        .setIssuedAt()
        .setExpirationTime('7d')
        .sign(secret())
    const jar = await cookies()
    jar.set(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', path: '/' })
}

/**
 * Simulated-mode-only surface used by /api/auth/dev-signin AND /api/simulator/viewpoint (NOT part of
 * AuthPort). Restores the person's remembered active org (Simulator continuity) when it's still
 * one they belong to, else falls back to their first membership; also sets the viewpoint cookie so
 * the Simulator panel's "whose world am I looking at" follows this sign-in. (Cross-tenant hopping
 * is picking a person whose home tenant differs — the person IS the site you're inhabiting.)
 */
export async function devSignIn(personId: string): Promise<void> {
    const person = findPerson(personId)
    if (!person) throw new ForbiddenError(`unknown person: ${personId}`)
    const remembered = readSimulatorState().people[`person:${personId}`]?.activeOrgSlug
    const orgSlug =
        remembered && person.memberships.some((m) => m.orgSlug === remembered)
            ? remembered
            : person.memberships[0].orgSlug
    await writeSession(person.id, orgSlug)
    await writeViewpointCookie(`person:${personId}`)
}

/**
 * Simulated-mode-only surface used by /api/auth/accept-invite (NOT part of AuthPort — same doc-comment
 * convention as devSignIn). The real analog is Clerk's client-side ticket-strategy sign-up
 * (packages/keel/src/adapters/real/accept-invite-form.tsx), which isn't expressible as a server port method:
 * there's no session yet to call it against. Turns a pending invite into a full person, appends
 * it to the people.json overlay, removes the invite, signs the new person in, and points the
 * Simulator viewpoint cookie at them so the panel follows the switch.
 */
export async function acceptInvite(
    inviteId: string,
    profile: { name: string; locale?: string },
): Promise<{ id: string; tenantSlug: string }> {
    const invite = findInvite(inviteId)
    if (!invite) throw new ForbiddenError(`unknown invite: ${inviteId}`)
    const name = profile.name.trim()
    if (!name) throw new ForbiddenError('name is required')

    const person: SeedPerson = {
        id: `person-invited-${inviteId.slice(0, 8)}`,
        name,
        email: invite.email,
        // The new person starts life in the language they accepted the invite in.
        locale: LOCALES.includes(profile.locale as Locale) ? (profile.locale as Locale) : 'en',
        // Ambient site is the tenant that owns the org they were invited into.
        tenantSlug: findOrg(invite.orgSlug)?.tenantSlug ?? '',
        memberships: [{ orgSlug: invite.orgSlug, role: invite.role }],
        restricted: invite.role === 'restricted',
    }
    await writeJsonAtomic(peopleFile(), [...listDynamicPeople(), person])
    await writeJsonAtomic(
        invitesFile(),
        readInvites().filter((i) => i.id !== inviteId),
    )
    await writeSession(person.id, invite.orgSlug)
    await writeViewpointCookie(`person:${person.id}`)
    return { id: person.id, tenantSlug: person.tenantSlug }
}

export const fakeAuth: AuthPort = {
    async getCurrentUser(): Promise<AuthUser | null> {
        const session = await readSession()
        return session ? toUser(session.person, session.orgSlug) : null
    },

    async requireUser(): Promise<AuthUser> {
        const user = await this.getCurrentUser()
        if (!user) throw new AuthRequiredError()
        return user
    },

    async requireRole(...roles: Role[]): Promise<AuthUser> {
        const user = await this.requireUser()
        if (!roles.includes(user.role)) throw new ForbiddenError(`requires one of: ${roles.join(', ')}`)
        return user
    },

    signInPath(returnTo?: string): string {
        return returnTo ? `/signin?returnTo=${encodeURIComponent(returnTo)}` : '/signin'
    },

    async signOut(): Promise<void> {
        const jar = await cookies()
        jar.delete(COOKIE_NAME)
    },

    async updateProfile(update: ProfileUpdate): Promise<AuthUser> {
        const session = await readSession()
        if (!session) throw new AuthRequiredError()
        if (update.locale && !LOCALES.includes(update.locale)) throw new ForbiddenError('unknown locale')
        const overrides = readOverrides()
        overrides[session.person.id] = { ...overrides[session.person.id], ...update }
        await writeJsonAtomic(overridesFile(), overrides)
        return toUser(session.person, session.orgSlug)
    },

    async listMembers(orgSlug: string): Promise<Membership[]> {
        const members: Membership[] = listAllPeople()
            .filter((p) => p.memberships.some((m) => m.orgSlug === orgSlug))
            .map((p) => {
                const user = toUser(p, orgSlug)
                return { id: p.id, name: user.name, email: p.email, role: user.role, status: 'active' as const }
            })
        const invited: Membership[] = readInvites()
            .filter((i) => i.orgSlug === orgSlug)
            .map((i) => ({ id: i.id, name: null, email: i.email, role: i.role, status: 'invited' as const }))
        return [...members, ...invited]
    },

    async createInvite(invite: InviteInput): Promise<Membership> {
        if (!isRole(invite.role)) throw new ForbiddenError('unknown role')
        const stored: StoredInvite = {
            id: crypto.randomUUID(),
            email: invite.email,
            role: invite.role,
            orgSlug: invite.orgSlug,
            invitedAt: new Date().toISOString(),
        }
        await writeJsonAtomic(invitesFile(), [...readInvites(), stored])
        return { id: stored.id, name: null, email: stored.email, role: stored.role, status: 'invited' }
    },

    async listMyOrgs(): Promise<OrgRef[]> {
        const session = await readSession()
        if (!session) return []
        return orgsForPerson(session.person)
    },

    async setActiveOrg(orgSlug: string): Promise<void> {
        const session = await readSession()
        if (!session) throw new AuthRequiredError()
        if (!session.person.memberships.some((m) => m.orgSlug === orgSlug)) {
            throw new ForbiddenError(`no membership in org: ${orgSlug}`)
        }
        await writeSession(session.person.id, orgSlug)
        updatePersonState(`person:${session.person.id}`, { activeOrgSlug: orgSlug })
    },
}
