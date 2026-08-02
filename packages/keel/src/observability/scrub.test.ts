import { describe, expect, test } from 'vitest'
import { scrubEvent } from './scrub'

describe('scrubEvent', () => {
    test('removes cookies, sensitive headers, query strings, and user pii', () => {
        const event = scrubEvent({
            request: {
                cookies: { app_session: 'secret' },
                query_string: 'returnTo=/x',
                headers: { Cookie: 'app_session=secret', Authorization: 'Bearer t', accept: 'text/html' },
            },
            user: { id: 'fixture-lead', email: 'ada@example.test', ip_address: '10.0.0.1' },
        })
        expect(event.request?.cookies).toBeUndefined()
        expect(event.request?.query_string).toBeUndefined()
        expect(event.request?.headers).toEqual({ accept: 'text/html' })
        expect(event.user).toEqual({ id: 'fixture-lead' })
    })

    test('passes through events without request/user', () => {
        expect(scrubEvent({ message: 'plain' })).toEqual({ message: 'plain' })
    })
})
