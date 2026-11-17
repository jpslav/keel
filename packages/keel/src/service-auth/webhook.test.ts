import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { makeTestTmpDir } from '../../../../tests/support/tmp-dir'
import { devWebhookSecret } from '../adapters/fake/service-auth'
import { AuthRequiredError } from '../ports/errors'
import { verifyWebhookCaller, withWebhookSecret } from './webhook'

// isSimulated is the one thing from '../adapters/index' webhook.ts touches — mock it (real import trips
// server-only in a test env) and make it mutable so the env-secret branch is exercisable too.
const state = vi.hoisted(() => ({ fake: true }))
vi.mock('../adapters/index', () => ({
    get isSimulated() {
        return state.fake
    },
}))

const tmp = makeTestTmpDir('app-webhook-')
beforeAll(() => {
    process.env.APP_DATA_DIR = tmp
})
afterAll(() => {
    delete process.env.APP_DATA_DIR
})
afterEach(() => {
    state.fake = true
    delete process.env.WEBHOOK_SECRET
})

function req(secret?: string, scheme = 'Bearer'): Request {
    const headers: Record<string, string> = {}
    if (secret !== undefined) headers.authorization = `${scheme} ${secret}`
    return new Request('http://localhost/api/webhooks/jobs', { method: 'POST', headers })
}

describe('verifyWebhookCaller (simulated mode)', () => {
    test('the dev secret passes', () => {
        expect(() => verifyWebhookCaller(req(devWebhookSecret()))).not.toThrow()
    })
    test('a wrong secret of equal-ish length is rejected', () => {
        const wrong = 'f'.repeat(devWebhookSecret().length)
        expect(() => verifyWebhookCaller(req(wrong))).toThrow(AuthRequiredError)
    })
    test('a length-mismatched secret is rejected (no timingSafeEqual throw)', () => {
        expect(() => verifyWebhookCaller(req('short'))).toThrow(AuthRequiredError)
    })
    test('a missing header is rejected', () => {
        expect(() => verifyWebhookCaller(req())).toThrow(AuthRequiredError)
    })
    test('a non-Bearer scheme is rejected', () => {
        expect(() => verifyWebhookCaller(req(devWebhookSecret(), 'Basic'))).toThrow(AuthRequiredError)
    })
})

describe('verifyWebhookCaller (real mode, env secret)', () => {
    test('the configured WEBHOOK_SECRET passes', () => {
        state.fake = false
        process.env.WEBHOOK_SECRET = 'env-secret-abcdef0123456789'
        expect(() => verifyWebhookCaller(req('env-secret-abcdef0123456789'))).not.toThrow()
    })
    test('a wrong secret is rejected in real mode', () => {
        state.fake = false
        process.env.WEBHOOK_SECRET = 'env-secret-abcdef0123456789'
        expect(() => verifyWebhookCaller(req('nope'))).toThrow(AuthRequiredError)
    })
    test('no configured secret rejects everything', () => {
        state.fake = false
        delete process.env.WEBHOOK_SECRET
        expect(() => verifyWebhookCaller(req('anything'))).toThrow(AuthRequiredError)
    })
})

describe('withWebhookSecret', () => {
    test('answers a request with no secret, a wrong one or a malformed header with an opaque 401, and never calls the handler', async () => {
        let calls = 0
        const guarded = withWebhookSecret(async () => {
            calls += 1
            return Response.json({ ok: true })
        })
        const wrong = 'f'.repeat(devWebhookSecret().length)

        for (const request of [req(), req(wrong), req(devWebhookSecret(), 'Basic')]) {
            const response = await guarded(request)
            expect(response.status).toBe(401)
            expect(await response.json()).toEqual({ error: 'unauthorized' })
        }
        expect(calls).toBe(0)
    })

    test('runs the handler, and returns its response, for the shared secret', async () => {
        const seen: Request[] = []
        const guarded = withWebhookSecret(async (request) => {
            seen.push(request)
            return Response.json({ ok: true, ran: 1 }, { status: 202 })
        })
        const request = req(devWebhookSecret())

        const response = await guarded(request)

        expect(response.status).toBe(202)
        expect(await response.json()).toEqual({ ok: true, ran: 1 })
        expect(seen).toEqual([request])
    })

    test("an error the handler throws is the handler's own: it propagates and is never turned into a 401", async () => {
        const guarded = withWebhookSecret(async () => {
            throw new Error('the handler broke')
        })
        await expect(guarded(req(devWebhookSecret()))).rejects.toThrow('the handler broke')
    })

    test('a first request with the WRONG secret still creates the per-checkout dev secret, so a developer can read it', async () => {
        // docs/adopting.md ("The scheduled tick") tells a developer to POST once, then read the file: pin that it holds.
        const { existsSync, rmSync } = await import('node:fs')
        const path = await import('node:path')
        const file = path.join(tmp, 'auth', 'webhook-secret')
        rmSync(file, { force: true }) // earlier tests in this file already created it
        expect(existsSync(file)).toBe(false)
        const guarded = withWebhookSecret(async () => Response.json({ ok: true }))

        expect((await guarded(req('x'))).status).toBe(401)

        expect(existsSync(file)).toBe(true)
    })

    test('real mode checks WEBHOOK_SECRET, and an unset one never authorizes', async () => {
        state.fake = false
        const guarded = withWebhookSecret(async () => Response.json({ ok: true }))
        expect((await guarded(req('anything'))).status).toBe(401)
        process.env.WEBHOOK_SECRET = 'real-secret-value'
        expect((await guarded(req('real-secret-value'))).status).toBe(200)
        expect((await guarded(req(devWebhookSecret()))).status).toBe(401)
    })
})
