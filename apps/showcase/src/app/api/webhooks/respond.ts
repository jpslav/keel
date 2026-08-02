import { AuthRequiredError } from 'keel/ports/errors'
import { verifyMailgunWebhook } from 'keel/service-auth/mailgun'
import { verifyWebhookCaller } from 'keel/service-auth/webhook'
import { withPortErrors } from '../respond'

/**
 * Wraps an inbound-webhook route handler. Checks the shared bearer secret on the FIRST line — a
 * missing/wrong secret is an opaque 401 `{ error: 'unauthorized' }` — then runs the handler inside
 * withPortErrors, whose InvalidTransitionError → 409 mapping means a webhook redelivery racing a
 * state change surfaces as a 409, not a 500.
 *
 * Like /api/service/*, these routes ship in REAL builds; never add `export const runtime = 'edge'`
 * (node:crypto for the constant-time secret compare).
 */
export function withWebhookSecret<P = Record<string, string>>(
    handler: (ctx: { request: Request; params: P }) => Promise<Response>,
): (request: Request, context: { params: Promise<P> }) => Promise<Response> {
    return async (request, context) => {
        try {
            verifyWebhookCaller(request)
        } catch (error) {
            if (error instanceof AuthRequiredError) return Response.json({ error: 'unauthorized' }, { status: 401 })
            throw error
        }
        const params = (await context?.params) as P
        // withPortErrors already maps InvalidTransitionError → the 409 body described above.
        return withPortErrors(() => handler({ request, params }))
    }
}

/**
 * Wraps the Mailgun INBOUND webhook route. Mailgun POSTs `multipart/form-data` and signs the
 * request as HMAC-SHA256(signingKey, `${timestamp}${token}`); this reads the form ONCE, verifies the
 * signature + freshness + single-use token (verifyMailgunWebhook), then hands the parsed FormData to the
 * handler. A missing/invalid signature is the same opaque 401 as the bearer path; an unparseable body is
 * a 400. Sits under the `webhooks/` authorize()-exemption (a machine caller, not a user session — the
 * exemption's mustMatch accepts this wrapper as well as withWebhookSecret). Ships in REAL builds; keep
 * the node runtime upstream for consistency with the bearer wrapper (the Mailgun compare itself is the
 * pure-TS timingSafeHexEqual from core, not node:crypto).
 */
export function withMailgunSignature(
    handler: (ctx: { form: FormData; request: Request }) => Promise<Response>,
): (request: Request) => Promise<Response> {
    return async (request) => {
        return withPortErrors(async () => {
            let form: FormData
            try {
                form = await request.formData()
            } catch {
                return Response.json({ error: 'invalid-payload' }, { status: 400 })
            }
            try {
                verifyMailgunWebhook({
                    timestamp: String(form.get('timestamp') ?? ''),
                    token: String(form.get('token') ?? ''),
                    signature: String(form.get('signature') ?? ''),
                })
            } catch (error) {
                if (error instanceof AuthRequiredError) {
                    return Response.json({ error: 'unauthorized' }, { status: 401 })
                }
                throw error
            }
            return handler({ form, request })
        })
    }
}
