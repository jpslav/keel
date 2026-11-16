import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { makeTestTmpDir } from '../../../../tests/support/tmp-dir'
import { devWebhookSecret } from '../adapters/fake/service-auth'
import { AuthRequiredError } from '../ports/errors'
import { verifyWebhookCaller } from './webhook'

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
