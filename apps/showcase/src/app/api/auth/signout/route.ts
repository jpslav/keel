import { auth } from 'keel/adapters/index'
import { withPortErrors } from '../../respond'

export async function POST(): Promise<Response> {
    return withPortErrors(async () => {
        await auth.signOut()
        return Response.json({ ok: true })
    })
}
