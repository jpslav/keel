import { devSignIn } from 'keel/adapters/fake/auth'
import { isSimulated } from 'keel/adapters/index'
import { withPortErrors } from '../../respond'

export async function POST(request: Request): Promise<Response> {
    if (!isSimulated) return Response.json({ error: 'not found' }, { status: 404 })
    return withPortErrors(async () => {
        const { personId } = (await request.json()) as { personId: string }
        await devSignIn(personId)
        return Response.json({ ok: true })
    })
}
