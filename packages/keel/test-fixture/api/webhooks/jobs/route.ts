/**
 * FIXTURE ROUTE — SCANNED, NEVER SERVED. See ../../dockets/route.ts for what this tree is.
 *
 * THIS FILE keeps the `webhooks/` PREFIX exemption alive: the caller is a machine authenticated by a
 * shared secret (or the Mailgun inbound signature), never a user session, so no per-actor ability
 * applies. The gate the exemption rests on is `withWebhookSecret` WRAPPING the handler, and the scan
 * checks it per verb: each mutating export must itself be the call, `export const POST =
 * withWebhookSecret(…)`, which is the shape every app's webhook route has. The guard's name in a string, in a
 * comment, or on another verb does not count.
 *
 * A local stand-in, for the same reason as the service route beside it: the wrapper is app-side. It returns
 * the handler Next would call, as the apps' wrappers do.
 */
const withWebhookSecret =
    (handler: () => Promise<Response>): ((request: Request) => Promise<Response>) =>
    () =>
        handler()

export const POST = withWebhookSecret(async () => Response.json({ ok: true }))
