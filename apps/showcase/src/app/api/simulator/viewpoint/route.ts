import { auth, isSimulated } from 'keel/adapters/index'
import { devSignIn, findInvite } from 'keel/adapters/fake/auth'
import { readSimulatorState, writeViewpointCookie, type PersonKey } from 'keel/adapters/fake/simulator'
import { LOCALES } from 'keel/core/locale'
import { withPortErrors } from '../../respond'

/** Same simulated-mode-only gate as /api/simulator/summary; no auth required to call this. */
export async function POST(request: Request): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        const { person, locale } = (await request.json()) as { person?: PersonKey; locale?: string }

        if (typeof locale !== 'string' || !(LOCALES as readonly string[]).includes(locale)) {
            return Response.json({ error: 'unknown locale' }, { status: 400 })
        }

        if (typeof person === 'string' && person.startsWith('invited:')) {
            // Switching TO an invited-but-unregistered person is a viewpoint change, not a
            // sign-in: there's no account yet, so the main pane goes signed-out (the welcome
            // page) while the panel keeps following them — that IS their "desktop".
            const inviteId = person.slice('invited:'.length)
            if (!findInvite(inviteId)) {
                return Response.json({ error: 'unknown invite' }, { status: 400 })
            }
            await auth.signOut()
            await writeViewpointCookie(person)
            return Response.json({ redirectTo: `/${locale}` })
        }

        if (typeof person !== 'string' || !person.startsWith('person:')) {
            return Response.json({ error: 'unsupported person key' }, { status: 400 })
        }

        const personId = person.slice('person:'.length)
        // devSignIn restores the person's remembered tenant and writes the viewpoint cookie.
        await devSignIn(personId)

        const state = readSimulatorState()
        const lastPath = state.people[person]?.lastPath
        return Response.json({ redirectTo: lastPath ?? `/${locale}/dashboard` })
    })
}
