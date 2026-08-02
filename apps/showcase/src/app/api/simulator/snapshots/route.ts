import { isSimulated } from 'keel/adapters/index'
import { listSnapshots, saveSnapshot } from 'keel/adapters/fake/simulator-admin'
import { withPortErrors } from '../../respond'

/** Same simulated-mode-only gate as the rest of /api/simulator/*; no auth required to call this. */
export async function GET(): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => Response.json({ snapshots: listSnapshots() }))
}

/** Saves (or overwrites) a named snapshot of the current world. Body: `{ name }`. */
export async function POST(request: Request): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        const { name } = (await request.json()) as { name?: string }
        if (typeof name !== 'string') return Response.json({ error: 'name is required' }, { status: 400 })

        await saveSnapshot(name)
        return new Response(null, { status: 204 })
    })
}
