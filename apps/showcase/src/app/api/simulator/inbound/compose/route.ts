import { auth, db, isSimulated } from 'keel/adapters/index'
import { DEMO_INBOUND_DOMAIN, formatInboundRecipient } from 'keel/core/inbound-email'
import { intakeInboundEmail } from 'keel/inbound-email/intake'
import { withPortErrors } from '../../../respond'

/**
 * Simulator "compose inbound" — the world emails the app. Simulator-mode gate, first line
 * (404 in real). This is the HONEST simulated-mode mechanism: rather than spoof a Mailgun signature, it
 * builds the intake address from the picked org + handler and calls the SAME intakeInboundEmail seam the
 * real signed webhook route uses. The ticket-creation authorization is identical in both modes (the intake
 * handler matches the sender email to an org member), so no per-actor session ability applies — this
 * sits under the `keel/` authorize()-exemption. See the decision log.
 */
export async function POST(request: Request): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        const body = (await request.json()) as {
            from?: unknown
            orgSlug?: unknown
            handler?: unknown
            subject?: unknown
            body?: unknown
        }
        const from = typeof body.from === 'string' ? body.from.trim() : ''
        const orgSlug = typeof body.orgSlug === 'string' ? body.orgSlug.trim() : ''
        const handler = typeof body.handler === 'string' ? body.handler.trim() : ''
        if (!from || !orgSlug || !handler) {
            return Response.json({ error: 'invalid-payload' }, { status: 400 })
        }
        const to = formatInboundRecipient(orgSlug, handler, DEMO_INBOUND_DOMAIN)
        const outcome = await intakeInboundEmail(db, auth, {
            to,
            from,
            subject: typeof body.subject === 'string' ? body.subject : '',
            bodyText: typeof body.body === 'string' ? body.body : '',
        })
        return Response.json({ ok: true, outcome })
    })
}
