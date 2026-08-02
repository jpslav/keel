import { isSimulated } from 'keel/adapters/index'
import { clearCaughtEmails } from 'keel/adapters/fake/email'
import { withPortErrors } from '../../../respond'

/** Empties the fake email catch store (.data/emails) so long dev sessions stay legible without a
 *  full world reset. Same simulated-mode-only gate as the rest of /api/simulator/*; no auth required. */
export async function POST(): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        clearCaughtEmails()
        return new Response(null, { status: 204 })
    })
}
