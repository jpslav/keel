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
