/**
 * Webhook signing — PURE, ISOMORPHIC TypeScript (ADR-0006, lint-enforced): no framework, no
 * `node:crypto`, no `crypto.subtle` global. It implements HMAC-SHA256 in plain TS over bytes so the
 * SAME helper signs on the server (packages/keel/src/db/webhooks.ts real + fake dispatch), verifies in tests, AND
 * runs inside the file:// static-demo twin — where a node builtin can't be bundled and Web Crypto's
 * secure-context/async caveats don't apply. Correctness is pinned by a colocated test that cross-checks
 * every output against `node:crypto` (see webhook-signing.test.ts); the storage-upload HMAC
 * (packages/keel/src/adapters/fake/storage.ts) is the shape precedent, but it lives in a node-only adapter and so
 * could use node:crypto — this can't.
 *
 * Scheme (Stripe-style): the signature covers `{timestamp}.{body}`; the header value is
 * `t=<unix-seconds>,v1=<hex>` under the signature header (WEBHOOK_SIGNATURE_HEADER, derived from
 * APP_SLUG — receivers pin the name at integration time, so it must carry the app's identity, not the
 * template's). The template teaches BOTH halves — signWebhookBody / webhookSignatureHeader for egress,
 * and verifyWebhookSignature (with a replay window) for the counterparty that receives it.
 */
import { APP_SLUG } from '@app-config/identity'

/** Outbound webhook header names. Derived, not literal: once a receiver validates signatures the
 *  names are a frozen external contract — an adopter must inherit `x-<their-app>-*`, never the
 *  template's brand. */
export const WEBHOOK_SIGNATURE_HEADER = `x-${APP_SLUG}-signature`
export const WEBHOOK_EVENT_HEADER = `x-${APP_SLUG}-event`
export const WEBHOOK_DELIVERY_HEADER = `x-${APP_SLUG}-delivery`

// ---- SHA-256 (FIPS 180-4), operating on Uint8Array ----

// prettier-ignore
const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function rotr(x: number, n: number): number {
    return (x >>> n) | (x << (32 - n))
}

const SHA256_BLOCK_BYTES = 64

function sha256(message: Uint8Array): Uint8Array {
    const h = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ])

    // Pad: append 0x80, then zeros, then the 64-bit big-endian bit length.
    const bitLen = message.length * 8
    const withPadLen = (((message.length + 8) >> 6) + 1) << 6 // multiple of 64 leaving room for 0x80 + length
    const padded = new Uint8Array(withPadLen)
    padded.set(message)
    padded[message.length] = 0x80
    // 64-bit length; JS bit ops are 32-bit, so write the high/low words separately. Bodies here are
    // far below 2^32 bits, but the high word is written for spec-correctness anyway.
    const dv = new DataView(padded.buffer)
    dv.setUint32(withPadLen - 4, bitLen >>> 0, false)
    dv.setUint32(withPadLen - 8, Math.floor(bitLen / 0x100000000), false)

    const w = new Uint32Array(64)
    for (let offset = 0; offset < padded.length; offset += SHA256_BLOCK_BYTES) {
        for (let i = 0; i < 16; i++) w[i] = dv.getUint32(offset + i * 4, false)
        for (let i = 16; i < 64; i++) {
            const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3)
            const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10)
            w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0
        }

        let [a, b, c, d, e, f, g, hh] = h
        for (let i = 0; i < 64; i++) {
            const S1 = rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25)
            const ch = (e! & f!) ^ (~e! & g!)
            const t1 = (hh! + S1 + ch + K[i]! + w[i]!) >>> 0
            const S0 = rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22)
            const maj = (a! & b!) ^ (a! & c!) ^ (b! & c!)
            const t2 = (S0 + maj) >>> 0
            hh = g
            g = f
            f = e
            e = (d! + t1) >>> 0
            d = c
            c = b
            b = a
            a = (t1 + t2) >>> 0
        }
        h[0] = (h[0]! + a!) >>> 0
        h[1] = (h[1]! + b!) >>> 0
        h[2] = (h[2]! + c!) >>> 0
        h[3] = (h[3]! + d!) >>> 0
        h[4] = (h[4]! + e!) >>> 0
        h[5] = (h[5]! + f!) >>> 0
        h[6] = (h[6]! + g!) >>> 0
        h[7] = (h[7]! + hh!) >>> 0
    }

    const out = new Uint8Array(32)
    const outView = new DataView(out.buffer)
    for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i]!, false)
    return out
}

// ---- HMAC-SHA256 (RFC 2104) ----

function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
    let normKey = key
    if (normKey.length > SHA256_BLOCK_BYTES) normKey = sha256(normKey)
    const block = new Uint8Array(SHA256_BLOCK_BYTES)
    block.set(normKey)

    const inner = new Uint8Array(SHA256_BLOCK_BYTES + message.length)
    const outerPrefix = new Uint8Array(SHA256_BLOCK_BYTES)
    for (let i = 0; i < SHA256_BLOCK_BYTES; i++) {
        inner[i] = block[i]! ^ 0x36
        outerPrefix[i] = block[i]! ^ 0x5c
    }
    inner.set(message, SHA256_BLOCK_BYTES)
    const innerHash = sha256(inner)

    const outer = new Uint8Array(SHA256_BLOCK_BYTES + innerHash.length)
    outer.set(outerPrefix)
    outer.set(innerHash, SHA256_BLOCK_BYTES)
    return sha256(outer)
}

const HEX = '0123456789abcdef'
function toHex(bytes: Uint8Array): string {
    let out = ''
    for (const byte of bytes) out += HEX[byte >> 4]! + HEX[byte & 0x0f]!
    return out
}

const encoder = new TextEncoder()

/** Default replay window the verifier tolerates between the signed timestamp and "now" (5 minutes). */
export const WEBHOOK_REPLAY_TOLERANCE_MS = 5 * 60_000

/** The raw v1 signature (hex HMAC-SHA256 over `{timestampSec}.{body}`) under `secret`. */
export function signWebhookBody(secret: string, body: string, timestampSec: number): string {
    const signed = `${timestampSec}.${body}`
    return toHex(hmacSha256(encoder.encode(secret), encoder.encode(signed)))
}

/** The full WEBHOOK_SIGNATURE_HEADER value: `t=<unix-seconds>,v1=<hex>`. */
export function webhookSignatureHeader(secret: string, body: string, timestampSec: number): string {
    return `t=${timestampSec},v1=${signWebhookBody(secret, body, timestampSec)}`
}

/** Parse `t=..,v1=..` (order-independent, tolerant of extra fields) into its parts, or null. */
function parseSignatureHeader(header: string): { t: number; v1: string } | null {
    let t: number | null = null
    let v1: string | null = null
    for (const part of header.split(',')) {
        const eq = part.indexOf('=')
        if (eq < 0) continue
        const key = part.slice(0, eq).trim()
        const value = part.slice(eq + 1).trim()
        if (key === 't') {
            const n = Number(value)
            if (Number.isFinite(n)) t = n
        } else if (key === 'v1') {
            v1 = value
        }
    }
    return t !== null && v1 !== null ? { t, v1 } : null
}

/** Constant-time equality for two equal-length hex strings (early-out only on a length mismatch). */
function timingSafeHexEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diff === 0
}

export type WebhookVerifyResult = { ok: true } | { ok: false; reason: 'malformed' | 'stale' | 'signature' }

/**
 * Verify an inbound webhook — the counterparty half the template teaches. Checks, in order: the header
 * parses (`malformed`); the signed timestamp is within `toleranceMs` of now, BOTH directions, so a
 * replayed OR future-dated request is rejected (`stale`); and the recomputed v1 matches in constant
 * time (`signature`). `now` is injectable for deterministic tests. The timestamp is checked only AFTER
 * it's structurally present but BEFORE trusting the signature body — a stale request is cheap to reject.
 */
export function verifyWebhookSignature(
    body: string,
    header: string | null | undefined,
    secret: string,
    opts: { toleranceMs: number; now?: Date },
): WebhookVerifyResult {
    if (!header) return { ok: false, reason: 'malformed' }
    const parsed = parseSignatureHeader(header)
    if (!parsed) return { ok: false, reason: 'malformed' }

    const nowMs = opts.now?.getTime() ?? Date.now()
    if (Math.abs(nowMs - parsed.t * 1000) > opts.toleranceMs) return { ok: false, reason: 'stale' }

    const expected = signWebhookBody(secret, body, parsed.t)
    return timingSafeHexEqual(expected, parsed.v1) ? { ok: true } : { ok: false, reason: 'signature' }
}

// ---------------------------------------------------------------------------
// Mailgun inbound signature — the RECEIVING half of the Mailgun vendor. Mailgun signs its
// webhooks/inbound routes as HMAC-SHA256(signingKey, `${timestamp}${token}`) → hex, a DIFFERENT
// concatenation from the Stripe-style `{t}.{body}` above. Rather than a second HMAC implementation, we
// expose the pure primitive (hmacSha256Hex) and build Mailgun's exact scheme on top of it, so the same
// node:crypto cross-check that pins the signer above pins this too. The signing-key LOOKUP + the token
// REPLAY guard are stateful and live in packages/keel/src/service-auth/mailgun.ts; the pure recompute + freshness
// window live here so the static-demo twin could verify as well.
// ---------------------------------------------------------------------------

/** Raw hex HMAC-SHA256 over an arbitrary (key, message) — the exposed pure primitive. */
export function hmacSha256Hex(key: string, message: string): string {
    return toHex(hmacSha256(encoder.encode(key), encoder.encode(message)))
}

/** Mailgun's expected signature: HMAC-SHA256(signingKey, `${timestamp}${token}`) as hex. */
export function mailgunSignature(signingKey: string, timestamp: string, token: string): string {
    return hmacSha256Hex(signingKey, `${timestamp}${token}`)
}

export type MailgunVerifyResult = { ok: true } | { ok: false; reason: 'malformed' | 'stale' | 'signature' }

/**
 * Verify a Mailgun inbound signature — the pure half (no replay state). Checks, in order: the fields
 * are structurally present and the timestamp is numeric (`malformed`); the timestamp is within
 * `toleranceMs` of `now` BOTH directions, so a stale OR future-dated request is rejected (`stale`);
 * and the recomputed HMAC matches in constant time (`signature`). `now` is injectable for tests. The
 * caller (service-auth) additionally rejects a re-used token within the window.
 */
export function verifyMailgunSignature(params: {
    signingKey: string
    timestamp: string
    token: string
    signature: string
    toleranceMs: number
    now?: Date
}): MailgunVerifyResult {
    const { signingKey, timestamp, token, signature } = params
    if (!timestamp || !token || !signature) return { ok: false, reason: 'malformed' }
    const tsSec = Number(timestamp)
    if (!Number.isFinite(tsSec)) return { ok: false, reason: 'malformed' }

    const nowMs = params.now?.getTime() ?? Date.now()
    if (Math.abs(nowMs - tsSec * 1000) > params.toleranceMs) return { ok: false, reason: 'stale' }

    const expected = mailgunSignature(signingKey, timestamp, token)
    return timingSafeHexEqual(expected, signature) ? { ok: true } : { ok: false, reason: 'signature' }
}
