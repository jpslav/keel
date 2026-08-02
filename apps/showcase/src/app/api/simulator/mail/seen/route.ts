import { isSimulated } from 'keel/adapters/index'
import { updatePersonState, type PersonKey } from 'keel/adapters/fake/simulator'
import { withPortErrors } from '../../../respond'

/** Same simulated-mode-only gate as the rest of /api/simulator/*; no auth required to call this. */
export async function POST(request: Request): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        const { person } = (await request.json()) as { person?: string }
        if (typeof person !== 'string' || !(person.startsWith('person:') || person.startsWith('invited:'))) {
            return Response.json({ error: 'unsupported person key' }, { status: 400 })
        }

        updatePersonState(person as PersonKey, { mailSeenAt: new Date().toISOString() })
        return Response.json({ ok: true })
    })
}
