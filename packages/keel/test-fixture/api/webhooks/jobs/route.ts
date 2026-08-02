/**
 * FIXTURE ROUTE — SCANNED, NEVER SERVED. See ../../dockets/route.ts for what this tree is.
 *
 * THIS FILE keeps the `webhooks/` PREFIX exemption alive: the caller is a machine authenticated by a
 * shared secret (or the Mailgun inbound signature), never a user session, so no per-actor ability
 * applies. The gate the exemption rests on is `withWebhookSecret`, and the scan checks this file
 * actually contains it.
 *
 * A local stand-in, for the same reason as the service route beside it: the wrapper is app-side.
 */
const withWebhookSecret = (handler: () => Promise<Response>): Promise<Response> => handler()

export async function POST(): Promise<Response> {
    return withWebhookSecret(async () => Response.json({ ok: true }))
}
