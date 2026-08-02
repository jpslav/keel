import { describe, expect, it } from 'vitest'
import { isWebhookEventKind } from 'keel/core/webhook-events'
import { appWebhookEventKinds } from './webhooks'

// The APP's webhook event kinds, and proof they compose into the framework's isWebhookEventKind.

describe('app webhook event kinds', () => {
    it('registers the escalation.* pair, composed into isWebhookEventKind', () => {
        expect(appWebhookEventKinds).toEqual(['escalation.created', 'escalation.decided'])
        for (const kind of appWebhookEventKinds) expect(isWebhookEventKind(kind)).toBe(true)
    })
})
