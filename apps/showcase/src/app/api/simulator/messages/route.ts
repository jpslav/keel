import { isSimulated } from 'keel/adapters/index'
import { listCaughtSms } from 'keel/adapters/fake/sms'
import { withPortErrors } from '../../respond'

/**
 * The Simulator Messages tab feed: every caught SMS across the simulated world, newest-first.
 * Simulated-mode-only — the first-line 404 gate keeps it out of real builds (the house simulator containment,
 * mustMatch-enforced by authorized-mutations.test.ts, though this is a GET). Reads the fake SMS
 * catch-store (`.data/sms/`), the mail-tab pattern applied to the SMS channel.
 */
export async function GET(): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        return Response.json({ messages: listCaughtSms() })
    })
}
