import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { startContractServer, type ContractServer } from '../../../../../tests/support/contract-postgres'
import { randomUUID } from 'node:crypto'
import { migrateToLatest } from '../../db/migrate'
import { up as grantAppUser } from '../../db/migrations/0015_app_user_grant'
import { runWithTenant } from '../../db/with-tenant'
import { runOwnerPass } from '../../db/owner-pass'
import { runRlsProofs } from '../../db/rls-proof-runner'
import type { DbPort } from '../../ports/db'
import { createRealDb } from './db'

/**
 * keel's OWN contract run: the composed proof suite over the framework's fixture seam
 * (packages/keel/test-fixture), on real Postgres, through the REAL db adapter — so what is proven is the
 * pool configuration production runs (its `date` parser included), not a hand-built one.
 *
 * It needs its own database. The fixture's migrations share 0001–0999 with the contract app's but differ
 * from 1001 up, and two such sets over one database make Kysely report corrupted migrations. So it
 * creates `keel_contract` on whichever server it is given: CONTRACT_DATABASE_URL's in CI, otherwise an
 * embedded-postgres of its own on the same derived port as the app harness — `vitest.contract.config.ts`
 * runs files one at a time, so the two never hold that port together.
 */

const DATABASE = 'keel_contract'

let server: ContractServer
let realDb: DbPort
/** The server's superuser URL (to its `postgres` database), kept for the non-superuser pass. */
let serverUrl: string

beforeAll(async () => {
    // The server, and `keel_contract` on it: CONTRACT_DATABASE_URL's in CI, otherwise an embedded-postgres of its own
    // (tests/support/contract-postgres.ts, which every contract suite shares).
    server = await startContractServer('keel-contract')
    serverUrl = server.url
    await server.createDatabase(DATABASE)

    const url = new URL(serverUrl)
    url.pathname = `/${DATABASE}`
    // Not migrated yet: the non-superuser pass below runs FIRST, so on a fresh server the owner's own
    // migration 0001 is what creates `app_user`, exactly as on a new Aurora cluster. The superuser pass
    // migrates `keel_contract` when its turn comes.
    realDb = createRealDb(url.toString())
}, 120_000)

afterAll(async () => {
    await realDb?.getDb().destroy()
    await server?.stop()
})

/** A connection for a login on this server, through the REAL adapter (its pool, its `date` parser). */
function connect(login: { database: string; user: string; password: string }) {
    const url = new URL(serverUrl)
    url.username = encodeURIComponent(login.user)
    url.password = encodeURIComponent(login.password)
    url.pathname = `/${login.database}`
    return createRealDb(url.toString()).getDb()
}

describe('keel fixture seam on real Postgres, through the real adapter (contract)', () => {
    // FIRST, deliberately (vitest runs a file's tests in order): on a fresh server, which a local run's
    // embedded one always is and CI's service is when this file runs before the app's, nothing has created
    // `app_user` yet, so the owner creates it itself. The next test runs the pass again on the same server,
    // which takes the branch a reused server takes (owner-pass.ts).
    // The pass every other one cannot be: a NON-SUPERUSER owner, as Aurora's master user is, runs the
    // migrations and makes every role switch in the proofs (packages/keel/src/db/owner-pass.ts).
    test('a non-superuser owner migrates, and switches to app_user inside withTenant', async () => {
        const server = new URL(serverUrl)
        const admin = connect({
            database: server.pathname.slice(1) || 'postgres',
            user: decodeURIComponent(server.username),
            password: decodeURIComponent(server.password),
        })
        try {
            await runOwnerPass(
                {
                    admin,
                    superuser: {
                        user: decodeURIComponent(server.username),
                        password: decodeURIComponent(server.password),
                    },
                    maintenanceDatabase: server.pathname.slice(1) || 'postgres',
                    connect,
                },
                expect,
            )
        } finally {
            await admin.destroy()
        }
    })

    // ...and again, now that the first owner's migration has created `app_user`: the branch a reused
    // server takes, where the owner is granted the creator's measured membership instead.
    test('a non-superuser owner migrates where app_user already exists, and switches too', async () => {
        const server = new URL(serverUrl)
        const admin = connect({
            database: server.pathname.slice(1) || 'postgres',
            user: decodeURIComponent(server.username),
            password: decodeURIComponent(server.password),
        })
        try {
            const existing = await sql<{
                n: number
            }>`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = 'app_user'`.execute(admin)
            expect(existing.rows[0]!.n).toBe(1)
            await runOwnerPass(
                {
                    admin,
                    superuser: {
                        user: decodeURIComponent(server.username),
                        password: decodeURIComponent(server.password),
                    },
                    maintenanceDatabase: server.pathname.slice(1) || 'postgres',
                    connect,
                },
                expect,
            )
        } finally {
            await admin.destroy()
        }
    })

    // Two databases on ONE cluster, migrated by different owners (staging and production on one Aurora
    // cluster): `app_user` is cluster-wide, so only whoever created it holds ADMIN. A second owner's
    // migration must stop at 0015 with the statement to run, roll back whole, and succeed once a role
    // holding ADMIN has run that statement VERBATIM.
    test('a second owner, with no ADMIN on an app_user someone else created, stops at 0015 with the remedy', async () => {
        const server = new URL(serverUrl)
        const superuser = { user: decodeURIComponent(server.username), password: decodeURIComponent(server.password) }
        const maintenance = server.pathname.slice(1) || 'postgres'
        const admin = connect({ ...superuser, database: maintenance })
        const stamp = Date.now()
        // Mixed case on purpose: the printed remedy must quote the name, or running it would name another role.
        const second = `Keel_Second_${stamp}`
        const creator = `keel_creator_${stamp}`
        const database = `keel_second_db_${stamp}`
        const login = { user: second, password: randomUUID() }
        const creatorLogin = { user: creator, password: randomUUID() }
        let ownerDb: ReturnType<typeof connect> | undefined
        try {
            // Someone else made app_user; this owner holds no membership in it at all. The role that runs
            // the remedy below holds what a creator holds (ADMIN only), not superuser.
            await sql`DO $$ BEGIN CREATE ROLE app_user NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`.execute(
                admin,
            )
            await sql`CREATE ROLE ${sql.id(creator)} LOGIN NOSUPERUSER PASSWORD ${sql.lit(creatorLogin.password)}`.execute(
                admin,
            )
            await sql`GRANT app_user TO ${sql.id(creator)} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`.execute(admin)
            await sql`CREATE ROLE ${sql.id(second)} LOGIN CREATEROLE CREATEDB NOSUPERUSER PASSWORD ${sql.lit(login.password)}`.execute(
                admin,
            )
            const bootstrap = connect({ ...login, database: maintenance })
            try {
                await sql`CREATE DATABASE ${sql.id(database)}`.execute(bootstrap)
            } finally {
                await bootstrap.destroy()
            }
            ownerDb = connect({ ...login, database })

            const failure = await migrateToLatest(ownerDb).then(
                () => null,
                (error: unknown) => String(error),
            )
            expect(failure).toMatch(new RegExp(`keel: role ${second} cannot switch to app_user`))
            // Kysely runs every pending migration in one transaction, so nothing of the run survives: no
            // migration recorded, and no table the earlier migrations created.
            const executed = await sql<{ n: number }>`SELECT count(*)::int AS n FROM kysely_migration`.execute(ownerDb)
            expect(executed.rows[0]!.n).toBe(0)
            const tenants = await sql<{ t: string | null }>`SELECT to_regclass('public.tenants')::text AS t`.execute(
                ownerDb,
            )
            expect(tenants.rows[0]!.t).toBeNull()

            // The remedy, exactly as the error states it, run by the ADMIN-only creator.
            const remedy = /run: (GRANT app_user TO \S+ WITH SET TRUE, INHERIT FALSE)/.exec(failure ?? '')?.[1]
            expect(remedy).toBe(`GRANT app_user TO "${second}" WITH SET TRUE, INHERIT FALSE`)
            const creatorDb = connect({ ...creatorLogin, database: maintenance })
            try {
                await sql.raw(remedy!).execute(creatorDb)
            } finally {
                await creatorDb.destroy()
            }

            // Now 0015 finds the switch already effective and grants nothing; everything migrates.
            await migrateToLatest(ownerDb)
            const inside = await runWithTenant(ownerDb, randomUUID(), (trx) =>
                sql<{ role: string }>`SELECT current_user AS role`.execute(trx),
            )
            expect(inside.rows[0]!.role).toBe('app_user')
        } finally {
            await ownerDb?.destroy()
            await sql`DROP DATABASE IF EXISTS ${sql.id(database)} WITH (FORCE)`.execute(admin).catch(() => undefined)
            await sql`DROP ROLE IF EXISTS ${sql.id(second)}`.execute(admin).catch(() => undefined)
            await sql`DROP ROLE IF EXISTS ${sql.id(creator)}`.execute(admin).catch(() => undefined)
            await admin.destroy()
        }
    })

    test('the full RLS proof suite passes', async () => {
        await realDb.migrateToLatest()
        await runRlsProofs(realDb.getDb(), expect)
    })

    // The server can end a connection at any time: a failover, a reboot, an idle-session timeout, a socket
    // dropped while a Lambda sat frozen between invocations. pg reports that as an 'error' EVENT, and an
    // event with no listener is an uncaught exception, which crashes the process. The adapter must survive
    // it both while the connection sits idle in the pool and while a transaction holds it.
    test('an idle pooled connection the server ends is logged, not a crash, and the pool carries on', async () => {
        const url = new URL(serverUrl)
        url.pathname = `/${DATABASE}`
        url.searchParams.set('application_name', 'keel_idle_probe')
        const probe = createRealDb(url.toString())
        const admin = connect({
            database: new URL(serverUrl).pathname.slice(1) || 'postgres',
            user: decodeURIComponent(new URL(serverUrl).username),
            password: decodeURIComponent(new URL(serverUrl).password),
        })
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        try {
            // One query, and its connection goes back to the pool idle.
            await sql`select 1`.execute(probe.getDb())
            const ended = await sql<{ n: number }>`
                SELECT count(*)::int AS n FROM (
                    SELECT pg_terminate_backend(pid) FROM pg_stat_activity
                    WHERE application_name = 'keel_idle_probe' AND state = 'idle'
                ) AS terminated`.execute(admin)
            expect(ended.rows[0]!.n).toBe(1)
            await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('57P01')))
            // The pool drops the dead client and opens a new one for the next query.
            const again = await sql<{ ok: number }>`select 1 as ok`.execute(probe.getDb())
            expect(again.rows).toEqual([{ ok: 1 }])
        } finally {
            warn.mockRestore()
            await probe.getDb().destroy()
            await admin.destroy()
        }
    })

    // ...and while a transaction holds the connection, which is every request: withTenant runs in one, and so
    // does the migrator. pg-pool listens only to IDLE clients, and Kysely adds no listener to the one it
    // checks out, so this case needs its own listener: the transaction fails, and nothing else does.
    test('a connection the server ends inside a transaction fails that transaction, not the process', async () => {
        const url = new URL(serverUrl)
        url.pathname = `/${DATABASE}`
        url.searchParams.set('application_name', 'keel_busy_probe')
        const probe = createRealDb(url.toString())
        const admin = connect({
            database: new URL(serverUrl).pathname.slice(1) || 'postgres',
            user: decodeURIComponent(new URL(serverUrl).username),
            password: decodeURIComponent(new URL(serverUrl).password),
        })
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        try {
            const outcome = await probe
                .getDb()
                .transaction()
                .execute(async (trx) => {
                    await sql`select 1`.execute(trx)
                    const ended = await sql<{ n: number }>`
                        SELECT count(*)::int AS n FROM (
                            SELECT pg_terminate_backend(pid) FROM pg_stat_activity
                            WHERE application_name = 'keel_busy_probe' AND state = 'idle in transaction'
                        ) AS terminated`.execute(admin)
                    expect(ended.rows[0]!.n).toBe(1)
                    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('57P01')))
                    await sql`select 1`.execute(trx)
                })
                .then(
                    () => 'committed',
                    (error: unknown) => error,
                )
            expect(outcome).toBeInstanceOf(Error)
            const again = await sql<{ ok: number }>`select 1 as ok`.execute(probe.getDb())
            expect(again.rows).toEqual([{ ok: 1 }])
        } finally {
            warn.mockRestore()
            await probe.getDb().destroy()
            await admin.destroy()
        }
    })
})

// Migration 0015 against a real server, branch by branch: what it grants, what it leaves alone, and how it
// fails. Each case is one throwaway non-superuser role, migrated by calling the migration's own `up`.
describe('migration 0015 on real Postgres', () => {
    interface Membership {
        grantor: string
        admin_option: boolean
        inherit_option: boolean
        set_option: boolean
    }

    async function withRole(
        run: (role: string, roleDb: ReturnType<typeof connect>, admin: ReturnType<typeof connect>) => Promise<void>,
    ) {
        const server = new URL(serverUrl)
        const superuser = { user: decodeURIComponent(server.username), password: decodeURIComponent(server.password) }
        const admin = connect({ ...superuser, database: DATABASE })
        const role = `keel_0015_${Date.now()}`
        const password = randomUUID()
        await sql`DO $$ BEGIN CREATE ROLE app_user NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`.execute(
            admin,
        )
        await sql`CREATE ROLE ${sql.id(role)} LOGIN CREATEROLE NOSUPERUSER PASSWORD ${sql.lit(password)}`.execute(admin)
        const roleDb = connect({ user: role, password, database: DATABASE })
        try {
            await run(role, roleDb, admin)
        } finally {
            await roleDb.destroy()
            await sql`DROP ROLE IF EXISTS ${sql.id(role)}`.execute(admin).catch(() => undefined)
            await admin.destroy()
        }
    }

    const membershipsOf = async (admin: ReturnType<typeof connect>, role: string) =>
        (
            await sql<Membership>`
                SELECT m.grantor::regrole::text AS grantor, m.admin_option, m.inherit_option, m.set_option
                FROM pg_auth_members m
                WHERE m.roleid = 'app_user'::regrole AND m.member = ${role}::regrole
                ORDER BY 1`.execute(admin)
        ).rows

    test("a creator's ADMIN-only membership gains a SET grant of its own, with INHERIT off", async () => {
        await withRole(async (role, roleDb, admin) => {
            await sql`GRANT app_user TO ${sql.id(role)} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`.execute(admin)
            await grantAppUser(roleDb)
            const rows = await membershipsOf(admin, role)
            expect(rows.find((m) => m.grantor === role)).toEqual({
                grantor: role,
                admin_option: false,
                inherit_option: false,
                set_option: true,
            })
            // ...and it can switch, which is the point.
            await roleDb.transaction().execute(async (trx) => {
                await sql`SET LOCAL ROLE app_user`.execute(trx)
            })
            // Run again: the memberships stay as they are. (The superuser case below is what pins the guard:
            // a re-run here would take the self-grant branch and change nothing even without it.)
            await grantAppUser(roleDb)
            expect(await membershipsOf(admin, role)).toEqual(rows)
        })
    })

    test('a membership the role granted itself keeps the INHERIT an operator chose, and gains SET', async () => {
        await withRole(async (role, roleDb, admin) => {
            await sql`GRANT app_user TO ${sql.id(role)} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`.execute(admin)
            // What `createrole_self_grant = 'inherit'` gives a creator: a self-granted INHERIT membership.
            await sql`GRANT app_user TO ${sql.id(role)} WITH INHERIT TRUE, SET FALSE`.execute(roleDb)
            await grantAppUser(roleDb)
            const own = (await membershipsOf(admin, role)).find((m) => m.grantor === role)
            expect(own?.inherit_option).toBe(true)
            expect(own?.set_option).toBe(true)
        })
    })

    test('a role with no ADMIN on app_user fails, and the error says what to run', async () => {
        await withRole(async (role, roleDb) => {
            await expect(grantAppUser(roleDb)).rejects.toThrow(
                new RegExp(`cannot switch to app_user.*GRANT app_user TO ${role} WITH SET TRUE`),
            )
        })
    })

    test('a superuser is granted nothing: it can already switch', async () => {
        // A FRESH superuser, not `postgres`: an earlier test in this file has already migrated as
        // `postgres`, so whatever 0015 would grant it would already be there to compare against.
        const server = new URL(serverUrl)
        const admin = connect({
            user: decodeURIComponent(server.username),
            password: decodeURIComponent(server.password),
            database: DATABASE,
        })
        const superRole = `keel_0015_su_${Date.now()}`
        const password = randomUUID()
        try {
            await sql`DO $$ BEGIN CREATE ROLE app_user NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`.execute(
                admin,
            )
            await sql`CREATE ROLE ${sql.id(superRole)} LOGIN SUPERUSER PASSWORD ${sql.lit(password)}`.execute(admin)
            const superDb = connect({ user: superRole, password, database: DATABASE })
            try {
                await grantAppUser(superDb)
            } finally {
                await superDb.destroy()
            }
            expect(await membershipsOf(admin, superRole)).toEqual([])
        } finally {
            await sql`DROP ROLE IF EXISTS ${sql.id(superRole)}`.execute(admin).catch(() => undefined)
            await admin.destroy()
        }
    })
})
