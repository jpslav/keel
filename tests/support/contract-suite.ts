import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { migrateToLatest } from 'keel/db/migrate'
import { runOwnerPass } from 'keel/db/owner-pass'
import { runRlsProofs } from 'keel/db/rls-proof-runner'
import { startContractServer, type ContractServer } from './contract-postgres'

/**
 * THE CONTRACT SUITE OF ONE APP: the migrations and the tenant-isolation proofs the unit tests run on pglite,
 * on real Postgres, in a database of this suite's own. Generic: it knows nothing of the app but what the seam
 * (`@app-config/*`, through keel's own `migrateToLatest` and `runRlsProofs`) hands it, so every app calls it the
 * same way, and the conformance kit (ADR-0014, P5) takes it over as it is.
 *
 *     defineContractSuite({ database: contractDatabaseName(APP_SLUG) })
 *
 * Three passes, in this order, which is deliberate:
 *  1. A NON-SUPERUSER OWNER migrates and runs the proofs, as Aurora's master user does (packages/keel/src/db/
 *     owner-pass.ts says why no other pass could see a missing role switch). It runs first so that on a fresh
 *     server the owner's own migration 0001 is what creates `app_user`.
 *  2. The same again, now that `app_user` exists: the branch a reused server takes (CI's service container is
 *     shared, so every suite after the first takes it).
 *  3. The full proof suite as a superuser, in this suite's own database (`database`).
 * Passes 1 and 2 each make a throwaway database and role and remove them; only pass 3 leaves `database` behind.
 *
 * It does not prove the framework's migration 0015 branch by branch or a second owner on one cluster: those are
 * about the framework's migration and run once, against keel's fixture
 * (packages/keel/src/adapters/real/db.contract.test.ts).
 */
export function defineContractSuite({ database }: { database: string }): void {
    let server: ContractServer

    beforeAll(async () => {
        server = await startContractServer(database)
        await server.createDatabase(database)
    }, 120_000)

    afterAll(async () => {
        await server?.stop()
    })

    const ownerPass = async () => {
        const admin = server.connectAsSuperuser(server.maintenanceDatabase)
        try {
            await runOwnerPass(
                {
                    admin,
                    superuser: server.superuser,
                    maintenanceDatabase: server.maintenanceDatabase,
                    connect: (login) => server.connect(login),
                },
                expect,
            )
        } finally {
            await admin.destroy()
        }
    }

    describe(`${database} on real Postgres (contract)`, () => {
        test('a non-superuser owner migrates, and switches to app_user inside withTenant', ownerPass)

        test('a non-superuser owner migrates where app_user already exists, and switches too', async () => {
            const admin = server.connectAsSuperuser(server.maintenanceDatabase)
            try {
                const existing = await sql<{
                    n: number
                }>`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = 'app_user'`.execute(admin)
                expect(existing.rows[0]!.n).toBe(1)
            } finally {
                await admin.destroy()
            }
            await ownerPass()
        })

        test('the full RLS proof suite passes', async () => {
            const db = server.connectAsSuperuser(database)
            await migrateToLatest(db)
            await runRlsProofs(db, expect)
        })
    })
}
