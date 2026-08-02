import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { createRealDb } from './db'

/**
 * Migrator Lambda handler (ADR-0001): runs the same migration registry the app, unit tests, and
 * contract tests use. Invoked by the CD pipeline before each release shifts traffic.
 * AUTHORED — CUTOVER (`cloud-accounts`).
 *
 * @public
 */
export async function handler(): Promise<{ ok: true }> {
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
