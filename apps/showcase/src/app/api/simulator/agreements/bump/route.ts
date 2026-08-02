import { isSimulated } from 'keel/adapters/index'
import { bumpWorldAgreement } from 'keel/adapters/fake/agreements'
import { withPortErrors } from '../../../respond'

/**
 * Bump one agreement's version (the demo story: re-arms the gate for everyone with a stale acceptance).
 * Simulated-mode-only Simulator god op (404 first line in real mode). No authorize(): the authorized-mutations
 * scanner exempts `keel/` on the `!isSimulated` first-line gate — this is a simulated-world control,
 * never a product mutation path.
 */
export async function POST(request: Request): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        const { agreementId } = (await request.json()) as { agreementId?: unknown }
        if (typeof agreementId !== 'string' || !agreementId) {
            return Response.json({ error: 'invalid-agreement' }, { status: 400 })
        }
        const result = await bumpWorldAgreement(agreementId)
        if (!result) return Response.json({ error: 'unknown agreement' }, { status: 404 })
        return Response.json({ version: result.version })
    })
}
