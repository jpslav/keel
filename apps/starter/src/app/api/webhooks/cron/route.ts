import { runScheduledTick } from 'keel/server-lib/scheduled-tick'
import { withWebhookSecret } from 'keel/service-auth/webhook'

/**
 * The scheduled-work tick (cutover row `scheduled-tick`). A scheduler POSTs here on a fixed cadence with
 * `Authorization: Bearer $WEBHOOK_SECRET`; a request without that secret is an opaque 401 before anything runs.
 * The body is ignored and the whole job is keel's `runScheduledTick`: drain the due schedules and the due webhook
 * deliveries. The starter has no Simulator routes, so without this route nothing ticks keel's scheduler there,
 * in a deployment or in `pnpm dev`.
 *
 * Authorization is the shared-secret guard, and the handler has to BE it: the authorize() scan exempts a
 * `webhooks/` handler (a machine caller, not a user session) only if that verb's export is a call to an imported
 * `withWebhookSecret` (or `withMailgunSignature`), as POST is here.
 */
export const POST = withWebhookSecret(async () => Response.json({ ok: true, ...(await runScheduledTick()) }))
