/**
 * Sentry event scrubbing (ADR-0010). Pure
 * TypeScript so it unit-tests without the SDK: strips cookies, auth headers, and query strings
 * before anything leaves the process.
 */

interface ScrubbableRequest {
    cookies?: unknown
    headers?: Record<string, string>
    query_string?: unknown
}

interface ScrubbableEvent {
    request?: ScrubbableRequest
    user?: { email?: string; ip_address?: string }
}

const SENSITIVE_HEADERS = ['cookie', 'authorization', 'x-api-key']

/** Generic over the SDK's event type so Sentry's beforeSend signatures typecheck unchanged. */
export function scrubEvent<T extends object>(event: T): T {
    const scrubbable = event as ScrubbableEvent
    if (scrubbable.request) {
        delete scrubbable.request.cookies
        delete scrubbable.request.query_string
        if (scrubbable.request.headers) {
            for (const header of Object.keys(scrubbable.request.headers)) {
                if (SENSITIVE_HEADERS.includes(header.toLowerCase())) delete scrubbable.request.headers[header]
            }
        }
    }
    if (scrubbable.user) {
        delete scrubbable.user.email
        delete scrubbable.user.ip_address
    }
    return event
}
