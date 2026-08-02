/**
 * Single source of truth for deployment and external-service parameters.
 *
 * Every PLACEHOLDER_ value maps to a row in docs/cutover-checklist.md describing what fills it and
 * when. Fields ending in `Name` are the names of secrets (env var / Secrets Manager entry) — secret
 * VALUES never live in the repo.
 *
 * WHAT IS LINT-ENFORCED (eslint.config.mjs `processEnvSelector`): `process.env` is read ONLY
 * inside packages/keel/src/adapters — every other module imports the resolved value (this file for
 * deployment/service params; `isSimulated`/`isDemoMode` from keel/adapters for run mode). Exemptions:
 * instrumentation files (NEXT_PUBLIC needs literal inlining) and the two secret readers
 * (service-auth/{webhook,mailgun}.ts).
 * NOT enforced: that a param's literal VALUE appears nowhere else in the repo — that stays a convention,
 * not a scanner.
 */

export const params = {
    aws: {
        // cutover: cloud-accounts
        devAccountId: 'PLACEHOLDER_AWS_DEV_ACCOUNT_ID',
        prodAccountId: 'PLACEHOLDER_AWS_PROD_ACCOUNT_ID',
        region: 'PLACEHOLDER_AWS_REGION',
    },
    domains: {
        // cutover: domains-and-certs — first deploys use *.cloudfront.net
        staging: 'PLACEHOLDER_STAGING_DOMAIN',
        production: 'PLACEHOLDER_PRODUCTION_DOMAIN',
        demo: 'PLACEHOLDER_DEMO_DOMAIN',
        certificateArn: 'PLACEHOLDER_ACM_CERTIFICATE_ARN',
    },
    clerk: {
        // cutover: auth-dev (development instance), auth-prod (production instance)
        publishableKeyName: 'PLACEHOLDER_CLERK_PUBLISHABLE_KEY_NAME',
        secretKeyName: 'PLACEHOLDER_CLERK_SECRET_KEY_NAME',
    },
    mailgun: {
        // cutover: email-outbound
        domain: 'PLACEHOLDER_MAILGUN_DOMAIN',
        apiKeyName: 'PLACEHOLDER_MAILGUN_API_KEY_NAME',
        // cutover: email-inbound — the HMAC signing key Mailgun signs inbound webhooks with
        webhookSigningKeyName: 'PLACEHOLDER_MAILGUN_WEBHOOK_SIGNING_KEY_NAME',
    },
    sentry: {
        // cutover: errors — the Sentry wiring is inert until a DSN is set
        dsn: 'PLACEHOLDER_SENTRY_DSN',
        org: 'PLACEHOLDER_SENTRY_ORG',
        project: 'PLACEHOLDER_SENTRY_PROJECT',
    },
    posthog: {
        // cutover: analytics — real adapter is enabled in staging/prod only
        projectKey: 'PLACEHOLDER_POSTHOG_PROJECT_KEY',
        host: 'PLACEHOLDER_POSTHOG_HOST',
    },
    anthropic: {
        // cutover: llm-key — unlocks `pnpm llm:record`
        apiKeyName: 'PLACEHOLDER_ANTHROPIC_API_KEY_NAME',
    },
} as const

export type Params = typeof params
