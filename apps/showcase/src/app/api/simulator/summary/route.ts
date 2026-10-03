import { auth, isSimulated } from 'keel/adapters/index'
import { listAllPeople, readInvites } from 'keel/adapters/fake/auth'
import { readSimulatorState, readViewpointCookie, type PersonKey } from 'keel/adapters/fake/simulator'
import { listCaughtEmails } from 'keel/adapters/fake/email'
import { findOrg } from '@app/seed'
import { withPortErrors } from '../../respond'

/**
 * Simulator-mode gate, not a role gate (design invariant): every surface works signed-out so
 * switching TO a low-privilege person can never strand you. 404s outside simulated mode, first line,
 * same pattern as /api/auth/dev-signin.
 */
export async function GET(): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        const user = await auth.getCurrentUser()
        const cookieViewpoint = await readViewpointCookie()
        const viewpoint: PersonKey | null = user ? (`person:${user.id}` as PersonKey) : cookieViewpoint

        const state = readSimulatorState()
        const emails = listCaughtEmails()

        function unreadFor(key: PersonKey, email: string): number {
            const mailSeenAt = state.people[key]?.mailSeenAt
            return emails.filter((item) => item.to === email && (!mailSeenAt || item.at > mailSeenAt)).length
        }

        // Seed + dynamic (accepted-invite) people are both full accounts; a pending invite is a
        // real People entry too — sourced live from invites.json, not pre-seeded (see simulator.ts).
        const personPeople = listAllPeople().map((person) => {
            const key: PersonKey = `person:${person.id}`
            return {
                key,
                name: person.name,
                email: person.email,
                role: person.memberships[0].role,
                orgs: person.memberships.map((membership) => ({ slug: membership.orgSlug, role: membership.role })),
                tenantSlug: person.tenantSlug,
                status: 'active' as const,
                hasAccount: true as const,
                unreadMail: unreadFor(key, person.email),
            }
        })

        const invitedPeople = readInvites().map((invite) => {
            const key: PersonKey = `invited:${invite.id}`
            return {
                key,
                name: null,
                email: invite.email,
                role: invite.role,
                orgs: [{ slug: invite.orgSlug, role: invite.role }],
                tenantSlug: findOrg(invite.orgSlug)?.tenantSlug ?? '',
                status: 'invited' as const,
                hasAccount: false as const,
                unreadMail: unreadFor(key, invite.email),
            }
        })

        return Response.json({ viewpoint, signedIn: !!user, people: [...personPeople, ...invitedPeople] })
    })
}
