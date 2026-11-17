import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The RDS Data API transport is OPT-IN (ADR-0002, addendum 2026-11-16): a `pg` deployment must never load
 * its SDK, so the transport sits behind a dynamic import in createRealPorts. These tests watch the module
 * loads themselves — a counter in each mock factory, which runs only when the module is actually imported —
 * rather than trusting the import statement to say so. Each test also proves the counters can move: the
 * data-api case must see both modules load.
 *
 * The other real adapters are stubbed: they are not what is being tested, and constructing them would
 * reach for vendor SDKs this test has no reason to load. `./db` is the real one (a pg Pool connects
 * lazily, so building it is offline).
 */
const loaded = vi.hoisted(() => ({ rdsDataSdk: 0, dataApiTransport: 0 }))

vi.mock('./auth', () => ({ realAuth: {} }))
vi.mock('./storage', () => ({ createRealStorage: () => ({}) }))
vi.mock('./llm', () => ({ createRealLlm: () => ({}) }))
vi.mock('./email', () => ({ createRealEmail: () => ({}) }))
vi.mock('./jobs', () => ({ createRealJobs: () => ({}) }))
vi.mock('./analytics', () => ({ createRealAnalytics: () => ({}) }))

const COMMON_ENV = {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk',
    CLERK_SECRET_KEY: 'sk',
    STORAGE_BUCKET: 'bucket',
    AWS_REGION: 'us-east-1',
    JOBS_CODEBUILD_PROJECT: 'jobs',
    WEBHOOK_SECRET: 'secret',
    ANTHROPIC_API_KEY: 'key',
    MAILGUN_DOMAIN: 'mg.example.com',
    MAILGUN_API_KEY: 'key',
    EMAIL_FROM: 'app@example.com',
    MAILGUN_WEBHOOK_SIGNING_KEY: 'key',
}
const DATA_API_ENV = {
    DATABASE_CLUSTER_ARN: 'arn:aws:rds:us-east-1:000000000000:cluster:c',
    DATABASE_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:000000000000:secret:s',
    DATABASE_NAME: 'app',
}

function stubEnv(env: Record<string, string | undefined>): void {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
}

beforeEach(() => {
    vi.resetModules()
    loaded.rdsDataSdk = 0
    loaded.dataApiTransport = 0
    // Registered per test, not hoisted: a hoisted factory is cached across resetModules, so it would
    // count only the FIRST load in this file and every later "never loads" would pass vacuously.
    vi.doMock('@aws-sdk/client-rds-data', async (importOriginal) => {
        loaded.rdsDataSdk += 1
        return importOriginal()
    })
    vi.doMock('./db-data-api', async (importOriginal) => {
        loaded.dataApiTransport += 1
        return importOriginal()
    })
    stubEnv({ ...COMMON_ENV, DATABASE_TRANSPORT: undefined, DATABASE_URL: undefined })
    stubEnv(Object.fromEntries(Object.keys(DATA_API_ENV).map((name) => [name, undefined])))
})

afterEach(() => {
    vi.unstubAllEnvs()
})

describe('the database transport is chosen by DATABASE_TRANSPORT, and the Data API is opt-in', () => {
    it.each([
        ['unset', undefined],
        ['pg', 'pg'],
    ])('a pg deployment (DATABASE_TRANSPORT %s) never loads the RDS Data SDK', async (_label, transport) => {
        stubEnv({ DATABASE_TRANSPORT: transport, DATABASE_URL: 'postgres://u:p@localhost:5432/app' })
        const { createRealPorts } = await import('./index')
        const ports = await createRealPorts()
        expect(loaded).toEqual({ rdsDataSdk: 0, dataApiTransport: 0 })
        await ports.db.getDb().destroy()
    })

    it('DATABASE_TRANSPORT=data-api loads it, and needs no DATABASE_URL', async () => {
        stubEnv({ DATABASE_TRANSPORT: 'data-api', ...DATA_API_ENV })
        const { createRealPorts } = await import('./index')
        const ports = await createRealPorts()
        expect(loaded.dataApiTransport).toBe(1)
        expect(loaded.rdsDataSdk).toBeGreaterThan(0)
        expect(typeof ports.db.withTenant).toBe('function')
    })

    it('an unknown transport fails instead of falling back to pg', async () => {
        stubEnv({ DATABASE_TRANSPORT: 'mysql', DATABASE_URL: 'postgres://u:p@localhost:5432/app' })
        const { createRealPorts } = await import('./index')
        await expect(createRealPorts()).rejects.toThrow(/DATABASE_TRANSPORT must be one of pg, data-api/)
    })

    it("each transport requires its own variables, and names its own cutover row when they're missing", async () => {
        const { assertRealEnv } = await import('./index')
        // From the same module registry as ./index (beforeEach resets it), or instanceof compares two classes.
        const { CutoverPendingError } = await import('../../ports/errors')
        stubEnv({ DATABASE_TRANSPORT: 'data-api', DATABASE_CLUSTER_ARN: DATA_API_ENV.DATABASE_CLUSTER_ARN })
        expect(() => assertRealEnv()).toThrow(CutoverPendingError)
        expect(() => assertRealEnv()).toThrow(/data-api.*DATABASE_SECRET_ARN, DATABASE_NAME/s)
        expect(() => assertRealEnv()).not.toThrow(/DATABASE_URL/)

        stubEnv({ DATABASE_TRANSPORT: 'pg' })
        expect(() => assertRealEnv()).toThrow(/cloud-accounts.*DATABASE_URL/s)
    })
})
