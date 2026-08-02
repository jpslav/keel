import { describe, expect, it } from 'vitest'
import {
    BACKOFF_SCHEDULE_MS,
    FRAMEWORK_WEBHOOK_EVENT_KINDS,
    MAX_DELIVERY_ATTEMPTS,
    WEBHOOK_EVENT_KINDS,
    backoffDelayMs,
    isDeliveryDead,
    isWebhookEventKind,
} from './webhook-events'

describe('webhook event registry', () => {
    it('recognizes registered kinds and rejects everything else', () => {
        // The framework kinds are always present; app kinds compose in (proven in app-config/webhooks.test).
        for (const kind of FRAMEWORK_WEBHOOK_EVENT_KINDS) expect(isWebhookEventKind(kind)).toBe(true)
        for (const kind of WEBHOOK_EVENT_KINDS) expect(isWebhookEventKind(kind)).toBe(true)
        expect(isWebhookEventKind('job.status_changed')).toBe(true)
        expect(isWebhookEventKind('nope')).toBe(false)
        expect(isWebhookEventKind('')).toBe(false)
        expect(isWebhookEventKind(null)).toBe(false)
        expect(isWebhookEventKind(42)).toBe(false)
    })
})

describe('backoff policy', () => {
    it('returns the scheduled delay per 1-based attempt', () => {
        expect(backoffDelayMs(1)).toBe(60_000)
        expect(backoffDelayMs(2)).toBe(5 * 60_000)
        expect(backoffDelayMs(3)).toBe(30 * 60_000)
        expect(backoffDelayMs(4)).toBe(2 * 60 * 60_000)
        expect(backoffDelayMs(5)).toBe(6 * 60 * 60_000)
    })

    it('is monotonically non-decreasing (a retry never comes sooner than the previous)', () => {
        for (let n = 2; n <= BACKOFF_SCHEDULE_MS.length; n++) {
            expect(backoffDelayMs(n) >= backoffDelayMs(n - 1)).toBe(true)
        }
    })

    it('clamps out-of-range attempts to the schedule bounds', () => {
        expect(backoffDelayMs(0)).toBe(BACKOFF_SCHEDULE_MS[0])
        expect(backoffDelayMs(-3)).toBe(BACKOFF_SCHEDULE_MS[0])
        expect(backoffDelayMs(999)).toBe(BACKOFF_SCHEDULE_MS[BACKOFF_SCHEDULE_MS.length - 1])
    })

    it('declares a delivery dead once the attempt budget is exhausted', () => {
        expect(isDeliveryDead(MAX_DELIVERY_ATTEMPTS - 1)).toBe(false)
        expect(isDeliveryDead(MAX_DELIVERY_ATTEMPTS)).toBe(true)
        expect(isDeliveryDead(MAX_DELIVERY_ATTEMPTS + 1)).toBe(true)
    })
})
