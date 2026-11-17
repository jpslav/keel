import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { createRealDataApiDb, createRealDb } from './db'

/**
 * Migrator Lambda handler (ADR-0001): runs the same migration registry the app, unit tests, and
 * contract tests use. Invoked by the CD pipeline before each release shifts traffic.
 * AUTHORED — CUTOVER (`cloud-accounts`; `data-api` for the Data API path).
 *
 * The driver follows the app's switch (`DATABASE_DRIVER`, ./index.ts). On the Data API, Kysely's
 * Migrator runs every pending migration in ONE Data API transaction, as it does on `pg` (Postgres DDL
 * is transactional). Two limits follow, and both fail loudly rather than half-apply: the transaction
 * dies after an hour (or three idle minutes), and any single statement still running at 45 seconds is
 * cancelled. A migration that cannot fit — a long backfill, an index on a large table — runs from inside
 * the VPC on the `pg` driver instead.
 *
 * @public
 */
export async function handler(): Promise<{ ok: true }> {
    if (process.env.DATABASE_DRIVER === 'data-api') {
        const { DATABASE_CLUSTER_ARN, DATABASE_SECRET_ARN, DATABASE_NAME } = process.env
        if (!DATABASE_CLUSTER_ARN || !DATABASE_SECRET_ARN || !DATABASE_NAME) {
            throw new Error('DATABASE_CLUSTER_ARN, DATABASE_SECRET_ARN and DATABASE_NAME must be set for the Data API')
        }
        const db = createRealDataApiDb({
            resourceArn: DATABASE_CLUSTER_ARN,
            secretArn: DATABASE_SECRET_ARN,
            database: DATABASE_NAME,
        })
        await db.migrateToLatest()
        return { ok: true }
    }

    const secretArn = process.env.DB_SECRET_ARN
    if (!secretArn) throw new Error('DB_SECRET_ARN is not set')

    const client = new SecretsManagerClient({})
    const secret = await client.send(new GetSecretValueCommand({ SecretId: secretArn }))
    const { host, port, username, password, dbname } = JSON.parse(secret.SecretString ?? '{}') as {
        host: string
        port: number
        username: string
        password: string
        dbname: string
    }

    const db = createRealDb(
        `postgres://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${dbname}`,
    )
    await db.migrateToLatest()
    return { ok: true }
}
