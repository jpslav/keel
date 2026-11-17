import { runScheduledTick } from 'keel/server-lib/scheduled-tick'
import { withWebhookSecret } from 'keel/service-auth/webhook'

/**
 * The scheduled-work tick (cutover row `scheduled-tick`). A scheduler POSTs here on a fixed cadence with
 * `Authorization: Bearer $WEBHOOK_SECRET`; a request without that secret is an opaque 401 before anything runs.
 * The body is ignored and the whole job is keel's `runScheduledTick`: drain the due schedules and the due webhook
 * deliveries. Without this route nothing ticks keel's scheduler, in `pnpm dev` or in a deployment.
 *
 * Authorization is the shared-secret guard, and the route file has to name it: the authorize() scan exempts a
 * `webhooks/` route (a machine caller, not a user session) only if the file calls `withWebhookSecret(`.
 */
export const POST = withWebhookSecret(async () => Response.json({ ok: true, ...(await runScheduledTick()) }))
