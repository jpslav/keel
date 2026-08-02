import { isSimulated } from 'keel/adapters/index'
import { deleteSnapshot } from 'keel/adapters/fake/simulator-admin'
import { withPortErrors } from '../../../respond'

/** Same simulated-mode-only gate as the rest of /api/simulator/*; no auth required to call this. Body:
 *  `{ name }`. 404s if the named snapshot doesn't exist (NotFoundError, mapped by withPortErrors). */
export async function POST(request: Request): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        const { name } = (await request.json()) as { name?: string }
        if (typeof name !== 'string') return Response.json({ error: 'name is required' }, { status: 400 })

        await deleteSnapshot(name)
        return new Response(null, { status: 204 })
    })
}
