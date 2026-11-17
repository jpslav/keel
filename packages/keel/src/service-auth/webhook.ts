import { timingSafeEqual } from 'node:crypto'
import { isSimulated } from '../adapters/index'
import { devWebhookSecret } from '../adapters/fake/service-auth'
import { AuthRequiredError } from '../ports/errors'

/**
 * The shared secret an inbound job webhook must present. Simulated mode uses the lazily-generated
 * per-checkout dev secret (statically imported behind isSimulated — the /api/auth/dev-signin
 * precedent for pulling a fake-only helper into shared glue); real mode uses WEBHOOK_SECRET from
 * the environment (a cutover row). Null when real mode has no secret configured → auth always fails.
 */
function expectedSecret(): string | null {
    return isSimulated ? devWebhookSecret() : (process.env.WEBHOOK_SECRET ?? null)
}

/**
 * Verifies an inbound webhook's bearer secret in constant time. A missing/malformed header, an
 * unset expected secret, or any mismatch throws the same opaque AuthRequiredError. timingSafeEqual
 * requires equal-length buffers, so a length mismatch is short-circuited to a non-match rather than
 * allowed to throw — the comparison itself never leaks length via timing.
 */
export function verifyWebhookCaller(request: Request): void {
    const header = request.headers.get('authorization')
    if (!header || !header.startsWith('Bearer ')) throw new AuthRequiredError()
    const presented = Buffer.from(header.slice('Bearer '.length))

    const expected = expectedSecret()
    if (!expected) throw new AuthRequiredError()
    const expectedBuf = Buffer.from(expected)

    if (presented.length !== expectedBuf.length || !timingSafeEqual(presented, expectedBuf)) {
        throw new AuthRequiredError()
    }
}

/**
 * Route guard for an inbound machine webhook: runs `handler` only for a request that presents the shared
 * secret (`verifyWebhookCaller`), and answers anything else with the same opaque 401 `{ error: 'unauthorized' }`
 * BEFORE the handler is called. Any other error is the handler's own and propagates.
 *
 * A route under `webhooks/` is exempt from the per-actor `authorize(...)` scan because a machine caller is not a
 * user session, and the scan accepts that on one condition: the route file must call `withWebhookSecret(` (or
 * `withMailgunSignature(`) by name. So an app's route is `export const POST = withWebhookSecret(...)`, never a
 * bare re-export of a handler that checks the secret somewhere out of the scan's sight. An app that wants port
 * errors mapped (a 409 for a lost state-machine race, say) wraps its own mapper inside, or uses its own guard
 * of the same name; this one deliberately maps nothing.
 */
export function withWebhookSecret(
    handler: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
    return async (request) => {
        try {
            verifyWebhookCaller(request)
        } catch (error) {
            if (error instanceof AuthRequiredError) return Response.json({ error: 'unauthorized' }, { status: 401 })
            throw error
        }
        return handler(request)
    }
}
