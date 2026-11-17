import type { AnalyticsPort } from '../../ports/analytics'
import type { AuthPort } from '../../ports/auth'
import type { DbPort } from '../../ports/db'
import type { EmailPort } from '../../ports/email'
import { CutoverPendingError } from '../../ports/errors'
import type { JobsPort } from '../../ports/jobs'
import type { LlmPort } from '../../ports/llm'
import type { StoragePort } from '../../ports/storage'
import { fakeAnalytics } from '../fake/analytics'
import { createRealAnalytics } from './analytics'
import { realAuth } from './auth'
import { createRealDataApiDb, createRealDb } from './db'
import { createRealEmail } from './email'
import { createRealJobs } from './jobs'
import { createRealLlm } from './llm'
import { createRealStorage } from './storage'

interface RealPorts {
    auth: AuthPort
    db: DbPort
    storage: StoragePort
    llm: LlmPort
    email: EmailPort
    analytics: AnalyticsPort
    jobs: JobsPort
}

/** Env var -> cutover-checklist row. Fails fast with the full list, not one var at a time. */
const REQUIRED_ENV: Record<string, string> = {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'auth-dev',
    CLERK_SECRET_KEY: 'auth-dev',
    STORAGE_BUCKET: 'cloud-accounts',
    AWS_REGION: 'cloud-accounts',
    JOBS_CODEBUILD_PROJECT: 'job-runner',
    WEBHOOK_SECRET: 'job-runner',
    ANTHROPIC_API_KEY: 'llm-key',
    MAILGUN_DOMAIN: 'email-outbound',
    MAILGUN_API_KEY: 'email-outbound',
    EMAIL_FROM: 'email-outbound',
    // Inbound: the key Mailgun signs inbound-route webhooks with — verified by the
    // /api/webhooks/email route (packages/keel/src/service-auth/mailgun.ts). Read at request time, not here.
    MAILGUN_WEBHOOK_SIGNING_KEY: 'email-inbound',
}

/**
 * How the app reaches Postgres — an explicit switch, never inferred from which variables happen to be
 * set (a deployment that half-configures the Data API must fail, not quietly fall back to `pg`).
 *
 * - `pg` (the default): node-postgres over a socket, from a Lambda inside the database's VPC.
 * - `data-api`: the RDS Data API over HTTPS, from a Lambda outside any VPC (ADR-0002, addendum
 *   2026-11-16). Its variables replace DATABASE_URL.
 */
const DATABASE_DRIVERS = ['pg', 'data-api'] as const
type DatabaseDriver = (typeof DATABASE_DRIVERS)[number]

const DATABASE_ENV: Record<DatabaseDriver, Record<string, string>> = {
    pg: { DATABASE_URL: 'cloud-accounts' },
    'data-api': { DATABASE_CLUSTER_ARN: 'data-api', DATABASE_SECRET_ARN: 'data-api', DATABASE_NAME: 'data-api' },
}

function databaseDriver(): DatabaseDriver {
    const value = process.env.DATABASE_DRIVER ?? 'pg'
    if (!(DATABASE_DRIVERS as readonly string[]).includes(value)) {
        throw new Error(`DATABASE_DRIVER must be one of ${DATABASE_DRIVERS.join(', ')} (got "${value}")`)
    }
    return value as DatabaseDriver
}

export function assertRealEnv(): void {
    const required = { ...REQUIRED_ENV, ...DATABASE_ENV[databaseDriver()] }
    const missing = Object.keys(required).filter((name) => !process.env[name])
    if (missing.length > 0) {
        const rows = [...new Set(missing.map((name) => required[name]))]
        throw new CutoverPendingError(
            rows as string[],
            `Missing env: ${missing.join(', ')}. See docs/cutover-checklist.md.`,
        )
    }
}

export function createRealPorts(): RealPorts {
    assertRealEnv()
    const env = process.env as Record<string, string>
    return {
        auth: realAuth,
        db:
            databaseDriver() === 'data-api'
                ? createRealDataApiDb({
                      resourceArn: env.DATABASE_CLUSTER_ARN,
                      secretArn: env.DATABASE_SECRET_ARN,
                      database: env.DATABASE_NAME,
                      region: env.AWS_REGION,
                  })
                : createRealDb(env.DATABASE_URL),
        storage: createRealStorage(env.STORAGE_BUCKET, env.AWS_REGION),
        llm: createRealLlm(env.ANTHROPIC_API_KEY),
        email: createRealEmail(env.MAILGUN_DOMAIN, env.MAILGUN_API_KEY, env.EMAIL_FROM),
        jobs: createRealJobs(env.JOBS_CODEBUILD_PROJECT, env.AWS_REGION),
        // PostHog only where a key is configured (staging/prod per ADR-0010); no-op otherwise.
        analytics: env.POSTHOG_KEY ? createRealAnalytics(env.POSTHOG_KEY, env.POSTHOG_HOST ?? '') : fakeAnalytics,
    }
}
