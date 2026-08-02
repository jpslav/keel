import { db, isSimulated, jobs } from 'keel/adapters/index'
import { worldNow } from 'keel/adapters/fake/clock'
import { runDueSchedules } from 'keel/db/schedules'
import { runDueDeliveries } from 'keel/db/webhooks'
import { dispatchWebhook } from 'keel/server-lib/webhook-dispatch'
import { withWebhookSecret } from '../respond'

/**
 * The scheduled-work tick. Real world: an EventBridge rule POSTs here on a fixed cadence
 * with `Authorization: Bearer $WEBHOOK_SECRET` (cutover row `scheduled-tick`) — the same inbound
 * webhook-secret seam as /api/webhooks/jobs, so it ships in real builds and is exempt from the
 * per-actor authorize() scan by that shared-secret precedent. The body is ignored; the tick just
 * drains due schedules.
 *
 * "Now" is the trigger source's clock: real mode uses real time; simulated mode uses the Simulator
 * world-clock (real time + the stored offset) so a simulated tick honours a clock the demo advanced.
 * worldNow() is called ONLY behind isSimulated, so the offset is structurally unreachable in a real
 * build — real time is always real time (see packages/keel/src/adapters/fake/clock.ts).
 *
 * The SAME tick drains due webhook deliveries: a scheduled digest that spawns a job whose
 * status change enqueues a delivery, and any retry whose backoff has elapsed, both fire from one tick.
 */
export const POST = withWebhookSecret(async () => {
    const now = isSimulated ? worldNow() : new Date()
    const { spawned, failed } = await runDueSchedules(db, jobs, now)
    const deliveries = await runDueDeliveries(db, now, dispatchWebhook)
    return Response.json({ ok: true, spawned, failed, deliveries })
})
