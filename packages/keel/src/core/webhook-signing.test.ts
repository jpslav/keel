import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
    WEBHOOK_REPLAY_TOLERANCE_MS,
    hmacSha256Hex,
    mailgunSignature,
    signWebhookBody,
    verifyMailgunSignature,
    verifyWebhookSignature,
    webhookSignatureHeader,
} from './webhook-signing'

/**
 * The pure isomorphic HMAC-SHA256 in webhook-signing.ts can't use node:crypto (it must bundle into the
 * file:// twin), so its correctness is pinned HERE by cross-checking every signature against
 * node:crypto — the canonical implementation. A test may import node:crypto freely.
 */
function reference(secret: string, body: string, ts: number): string {
    return createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')
}

describe('webhook signing (pure HMAC-SHA256 == node:crypto)', () => {
    const cases: { secret: string; body: string; ts: number }[] = [
        { secret: 'whsec_test', body: '', ts: 0 },
        { secret: 'whsec_test', body: '{"id":"d1","kind":"job.status_changed"}', ts: 1_700_000_000 },
        { secret: 's', body: 'a'.repeat(1), ts: 1 },
        // assorted lengths around SHA-256 block boundaries (the signed message is `${ts}.${body}`)
        { secret: 'k', body: 'x'.repeat(55), ts: 42 },
        { secret: 'k', body: 'x'.repeat(56), ts: 42 },
        { secret: 'k', body: 'x'.repeat(64), ts: 42 },
        { secret: 'k', body: 'x'.repeat(120), ts: 42 },
        // EXACT padding boundaries of the signed message: with ts=1 the prefix "1." is 2 bytes, so
        // body length n gives message length n+2 — these hit 55/56/63/64/119/120 precisely.
        { secret: 'k', body: 'x'.repeat(53), ts: 1 },
        { secret: 'k', body: 'x'.repeat(54), ts: 1 },
        { secret: 'k', body: 'x'.repeat(61), ts: 1 },
        { secret: 'k', body: 'x'.repeat(62), ts: 1 },
        { secret: 'k', body: 'x'.repeat(117), ts: 1 },
        { secret: 'k', body: 'x'.repeat(118), ts: 1 },
        // HMAC key-length threshold: pad branch runs through exactly 64 bytes; the hash branch starts
        // at 65 (an off-by-one in the `> 64` check would fail one of these against node:crypto)
        { secret: 'K'.repeat(64), body: 'payload', ts: 999 },
        { secret: 'K'.repeat(65), body: 'payload', ts: 999 },
        { secret: 'K'.repeat(100), body: 'payload', ts: 999 },
        // unicode body (UTF-8 multibyte)
        { secret: 'clé', body: 'café ☕ 日本語', ts: 123456 },
    ]

    for (const { secret, body, ts } of cases) {
        it(`matches node:crypto for secret=${secret.slice(0, 6)} len(body)=${body.length}`, () => {
            expect(signWebhookBody(secret, body, ts)).toBe(reference(secret, body, ts))
        })
    }

    it('formats the Stripe-style header', () => {
        const header = webhookSignatureHeader('whsec', 'body', 1700)
        expect(header).toBe(`t=1700,v1=${reference('whsec', 'body', 1700)}`)
    })
})

describe('webhook verification', () => {
    const secret = 'whsec_verify'
    const body = '{"id":"d1","data":{"x":1}}'
    const ts = 1_700_000_000
    const now = new Date(ts * 1000)
    const header = webhookSignatureHeader(secret, body, ts)

    it('accepts a fresh, untampered signature', () => {
        expect(verifyWebhookSignature(body, header, secret, { toleranceMs: WEBHOOK_REPLAY_TOLERANCE_MS, now })).toEqual(
            {
                ok: true,
            },
        )
    })

    it('rejects a tampered body', () => {
        const result = verifyWebhookSignature(`${body} `, header, secret, {
            toleranceMs: WEBHOOK_REPLAY_TOLERANCE_MS,
            now,
        })
        expect(result).toEqual({ ok: false, reason: 'signature' })
    })

    it('rejects a wrong secret', () => {
        const result = verifyWebhookSignature(body, header, 'wrong', {
            toleranceMs: WEBHOOK_REPLAY_TOLERANCE_MS,
            now,
        })
        expect(result).toEqual({ ok: false, reason: 'signature' })
    })

    it('rejects a stale timestamp outside the replay window', () => {
        const later = new Date((ts + 10 * 60) * 1000) // 10 minutes later, tolerance is 5
        const result = verifyWebhookSignature(body, header, secret, {
            toleranceMs: WEBHOOK_REPLAY_TOLERANCE_MS,
            now: later,
        })
        expect(result).toEqual({ ok: false, reason: 'stale' })
    })

    it('rejects a future-dated timestamp (replay both directions)', () => {
        const earlier = new Date((ts - 10 * 60) * 1000)
        const result = verifyWebhookSignature(body, header, secret, {
            toleranceMs: WEBHOOK_REPLAY_TOLERANCE_MS,
            now: earlier,
        })
        expect(result).toEqual({ ok: false, reason: 'stale' })
    })

    it('rejects malformed / missing headers', () => {
        for (const bad of [null, undefined, '', 'garbage', 't=1700', `v1=abc`]) {
            expect(
                verifyWebhookSignature(body, bad, secret, { toleranceMs: WEBHOOK_REPLAY_TOLERANCE_MS, now }).ok,
            ).toBe(false)
        }
    })
})

describe('mailgun inbound signature (HMAC over timestamp+token == node:crypto)', () => {
    // Mailgun concatenates `${timestamp}${token}` with NO separator — pin the pure impl against node:crypto.
    function mailgunReference(key: string, timestamp: string, token: string): string {
        return createHmac('sha256', key).update(`${timestamp}${token}`).digest('hex')
    }

    it('mailgunSignature matches node:crypto over timestamp+token', () => {
        const key = 'key-abc123'
        const timestamp = '1700000000'
        const token = 'a'.repeat(50)
        expect(mailgunSignature(key, timestamp, token)).toBe(mailgunReference(key, timestamp, token))
    })

    it('hmacSha256Hex exposes the same primitive', () => {
        expect(hmacSha256Hex('k', 'message')).toBe(createHmac('sha256', 'k').update('message').digest('hex'))
    })
})

describe('mailgun signature verification', () => {
    const signingKey = 'mg-signing-key'
    const timestamp = '1700000000'
    const token = 'token-xyz-0123456789'
    const now = new Date(Number(timestamp) * 1000)
    const signature = mailgunSignature(signingKey, timestamp, token)
    const base = { signingKey, timestamp, token, signature, toleranceMs: WEBHOOK_REPLAY_TOLERANCE_MS }

    it('accepts a fresh, correctly-signed request', () => {
        expect(verifyMailgunSignature({ ...base, now })).toEqual({ ok: true })
    })

    it('rejects a wrong signing key', () => {
        expect(verifyMailgunSignature({ ...base, signingKey: 'wrong', now })).toEqual({
            ok: false,
            reason: 'signature',
        })
    })

    it('rejects a tampered token (signature no longer matches)', () => {
        expect(verifyMailgunSignature({ ...base, token: `${token}!`, now })).toEqual({ ok: false, reason: 'signature' })
    })

    it('rejects a stale timestamp outside the window', () => {
        const later = new Date((Number(timestamp) + 10 * 60) * 1000)
        expect(verifyMailgunSignature({ ...base, now: later })).toEqual({ ok: false, reason: 'stale' })
    })

    it('rejects a future-dated timestamp', () => {
        const earlier = new Date((Number(timestamp) - 10 * 60) * 1000)
        expect(verifyMailgunSignature({ ...base, now: earlier })).toEqual({ ok: false, reason: 'stale' })
    })

    it('rejects missing / non-numeric fields as malformed', () => {
        expect(verifyMailgunSignature({ ...base, signature: '', now }).ok).toBe(false)
        expect(verifyMailgunSignature({ ...base, token: '', now }).ok).toBe(false)
        expect(verifyMailgunSignature({ ...base, timestamp: 'not-a-number', now })).toEqual({
            ok: false,
            reason: 'malformed',
        })
    })
})
