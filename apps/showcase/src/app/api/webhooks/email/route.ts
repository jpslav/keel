import { auth, db } from 'keel/adapters/index'
import { intakeInboundEmail } from 'keel/inbound-email/intake'
import { withMailgunSignature } from '../respond'

/**
 * Inbound email webhook — the RECEIVING half of the Mailgun vendor. Mailgun's inbound route
 * forwards a parsed message here as multipart form fields; withMailgunSignature verifies the signature,
 * freshness, and single-use token BEFORE this handler runs (a bad signature is a 401 before intake).
 *
 * Field mapping (Mailgun's inbound "parsed messages" format): `recipient` is the intake address,
 * `sender`/`from` the author, `stripped-text` the body with quoted history + signature already removed
 * by Mailgun (preferred), falling back to `body-plain`; `body-html` is kept when present. `subject` may
 * be absent (a body-only email).
 *
 * ALWAYS 200 after verification (poison-safe): intake catches handler failures internally and records
 * them, so a verified-but-unhandleable message returns 200 and Mailgun never retries it. Only an
 * infrastructure failure inside intake propagates → a real 500 → an appropriate Mailgun retry.
 *
 * DELIVERABILITY (bounce/complaint). A real Mailgun instance routes bounce/complaint events to a webhook
 * too; they'd enter through this same seam (a `deliverability` handler slug, or a sibling route sharing
 * verifyMailgunWebhook). NOT built here — noted in the `email-inbound` cutover row and ADR-0011
 * as the near-universal next handler.
 */
export const POST = withMailgunSignature(async ({ form }) => {
    const field = (name: string): string => String(form.get(name) ?? '')
    const outcome = await intakeInboundEmail(db, auth, {
        to: field('recipient'),
        from: field('sender') || field('from'),
        subject: field('subject'),
        bodyText: field('stripped-text') || field('body-plain'),
        bodyHtml: field('body-html') || null,
    })
    return Response.json({ ok: true, status: outcome.status, handler: outcome.handler, id: outcome.id })
})
