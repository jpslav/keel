import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { createRealDb } from './db'

/**
 * Migrator Lambda handler (ADR-0001): runs the same migration registry the app, unit tests, and
 * contract tests use. Invoked by the CD pipeline before each release shifts traffic.
 *
 * ROLES. The credentials here are the migrator's, and migration 0015 grants that role the switch to
 * `app_user`. If the application connects as a DIFFERENT role, that role needs the switch too. It cannot
 * grant itself that; this role, which created `app_user` and so holds ADMIN on it, or any other role with
 * ADMIN on `app_user`, runs:  GRANT app_user TO <app role> WITH SET TRUE, INHERIT TRUE;
 * (the `db-role-not-superuser` row in docs/cutover-checklist.md; ADR-0004, 2026-11-16 addendum).
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
