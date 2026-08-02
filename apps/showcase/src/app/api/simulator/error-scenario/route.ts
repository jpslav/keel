import { isSimulated } from 'keel/adapters/index'
import { scrubEvent } from 'keel/observability/scrub'
import { withPortErrors } from '../../respond'

/**
 * Throws a synthetic server-side error and returns the raw + scrubbed Sentry event shape, proving
 * scrubEvent works without a DSN. Fake secrets only — no real data (ADR-0010). Same simulated-mode-only
 * gate as the rest of /api/simulator/*; no auth required (mode, not role). Formerly
 * /api/dev/error; see docs/decision-log.md.
 */
export async function GET(): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })

    return withPortErrors(async () => {
        try {
            throw new Error('Test error (server) from Simulator')
        } catch (err) {
            const base = {
                message: (err as Error).message,
                request: {
                    headers: {
                        cookie: 'session=SECRET_COOKIE_VALUE',
                        authorization: 'Bearer SECRET_TOKEN',
                        'x-api-key': 'SECRET_API_KEY',
                        'user-agent': 'DevErrorsDemo/1.0',
                    },
                    cookies: { session: 'SECRET_COOKIE_VALUE' },
                    query_string: 'token=SECRET_QUERY',
                },
                user: { id: 'user_123', email: 'user@example.com', ip_address: '203.0.113.7' },
            }
            return Response.json({ raw: structuredClone(base), scrubbed: scrubEvent(structuredClone(base)) })
        }
    })
}
