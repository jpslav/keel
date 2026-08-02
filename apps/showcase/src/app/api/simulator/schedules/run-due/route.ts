import { db, isSimulated, jobs } from 'keel/adapters/index'
import { worldNow } from 'keel/adapters/fake/clock'
import { runDueSchedules } from 'keel/db/schedules'
import { runDueDeliveries } from 'keel/db/webhooks'
import { dispatchWebhook } from 'keel/server-lib/webhook-dispatch'
import { withPortErrors } from '../../../respond'

/**
 * Simulator "run due now" (simulated-mode-only; 404 in real): drains due schedules AND due webhook
 * deliveries at the current world clock WITHOUT moving it — the manual operator override,
 * the twin of the Jobs tab's "run pending jobs". Exempt from the authorize() scan by the simulator/
 * simulated-mode gate.
 */
export async function POST(): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        const now = worldNow()
        const { spawned, failed } = await runDueSchedules(db, jobs, now)
        const deliveries = await runDueDeliveries(db, now, dispatchWebhook)
        return Response.json({ ok: true, spawned, failed, deliveries })
    })
}
