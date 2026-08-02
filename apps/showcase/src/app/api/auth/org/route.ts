import { auth } from 'keel/adapters/index'
import { withPortErrors } from '../../respond'

export async function POST(request: Request): Promise<Response> {
    return withPortErrors(async () => {
        const { orgSlug } = (await request.json()) as { orgSlug: string }
        await auth.setActiveOrg(orgSlug)
        return Response.json({ ok: true })
    })
}
