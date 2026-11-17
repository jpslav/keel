import { runScheduledTick } from 'keel/server-lib/scheduled-tick'
import { withWebhookSecret } from '../respond'

/**
 * The scheduled-work tick. Real world: an EventBridge rule POSTs here on a fixed cadence
 * with `Authorization: Bearer $WEBHOOK_SECRET` (cutover row `scheduled-tick`) — the same inbound
 * webhook-secret seam as /api/webhooks/jobs, so it ships in real builds and is exempt from the
 * per-actor authorize() scan by that shared-secret precedent. The body is ignored; the tick just
 * drains due schedules and due webhook deliveries, which is keel's `runScheduledTick` (the starter carries the
 * same route over the same function). In a simulated world "now" is the Simulator's world clock.
 */
export const POST = withWebhookSecret(async () => Response.json({ ok: true, ...(await runScheduledTick()) }))
