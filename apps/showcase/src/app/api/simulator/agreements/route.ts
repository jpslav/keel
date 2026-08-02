import { isSimulated } from 'keel/adapters/index'
import { listWorldAgreements } from 'keel/adapters/fake/agreements'
import { withPortErrors } from '../../respond'

/** The Snapshots Agreements section's read: every agreement across all tenants with acceptance tallies.
 *  Simulated-mode-only god view (404 first line in real mode — the Simulator containment rule). */
export async function GET(): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        const agreements = await listWorldAgreements()
        return Response.json({ agreements })
    })
}
