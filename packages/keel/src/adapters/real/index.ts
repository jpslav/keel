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
import { createRealDb } from './db'
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
    DATABASE_URL: 'cloud-accounts',
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

export function assertRealEnv(): void {
    const missing = Object.keys(REQUIRED_ENV).filter((name) => !process.env[name])
    if (missing.length > 0) {
        const rows = [...new Set(missing.map((name) => REQUIRED_ENV[name]))]
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
        db: createRealDb(env.DATABASE_URL),
        storage: createRealStorage(env.STORAGE_BUCKET, env.AWS_REGION),
        llm: createRealLlm(env.ANTHROPIC_API_KEY),
        email: createRealEmail(env.MAILGUN_DOMAIN, env.MAILGUN_API_KEY, env.EMAIL_FROM),
        jobs: createRealJobs(env.JOBS_CODEBUILD_PROJECT, env.AWS_REGION),
        // PostHog only where a key is configured (staging/prod per ADR-0010); no-op otherwise.
        analytics: env.POSTHOG_KEY ? createRealAnalytics(env.POSTHOG_KEY, env.POSTHOG_HOST ?? '') : fakeAnalytics,
    }
}
