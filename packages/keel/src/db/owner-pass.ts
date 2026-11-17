import { type Kysely, sql } from 'kysely'
import { migrateToLatest } from './migrate'
import { runRlsProofs } from './rls-proof-runner'
import type { ProofExpectation } from './rls-proofs'
import type { DB } from './schema'
import { runWithTenant } from './with-tenant'

/**
 * THE NON-SUPERUSER PASS of the contract suite: keel's migrations and its RLS proofs, run the way a
 * real deployment runs them — as a database OWNER that is not a superuser (ADR-0004 addendum,
 * 2026-11-16).
 *
 * Why it exists. Every other contract pass connects as `postgres`, a superuser, and a superuser may
 * `SET ROLE` to any role. Aurora's master user is `NOSUPERUSER CREATEROLE`, and since Postgres 16 a
 * non-superuser that creates a role is granted ADMIN on it, but not SET. So the owner that created
 * `app_user` could not switch to it, and every `withTenant` failed closed with `permission denied to set
 * role "app_user"`. No gate could see it, because every gate was a superuser.
 *
 * How it is built, so another transport can run it. The pass only ever reaches the server through
 * `connect`: the default contract run hands it pooled `pg` connections, and the Data API transport
 * (#46) can hand it its own. A transport that needs a different admin handle supplies that too.
 */

/** A login to one database. */
export interface Login {
    database: string
    user: string
    password: string
}

export interface OwnerPassConnections {
    /** A SUPERUSER connection to a database that already exists on the server: it creates the owner. */
    admin: Kysely<DB>
    /** The superuser's own login: the privileged handle the proofs seed and run the negative control with. */
    superuser: { user: string; password: string }
    /** A database that already exists, for the owner to connect to while it creates its own. */
    maintenanceDatabase: string
    /** Open a connection for a login, through whichever transport this pass is proving. */
    connect: (login: Login) => Kysely<DB>
}

export async function runOwnerPass(
    connections: OwnerPassConnections,
    expect: (actual: unknown) => ProofExpectation,
): Promise<void> {
    const { admin, connect } = connections
    const stamp = Date.now()
    const owner = `keel_owner_${stamp}`
    const password = `owner-${stamp}`
    const database = `keel_owner_db_${stamp}`

    // Aurora's master user, as a role: may log in, create roles and databases, and is no superuser.
    await sql`CREATE ROLE ${sql.id(owner)} LOGIN CREATEROLE CREATEDB NOSUPERUSER PASSWORD ${sql.lit(password)}`.execute(
        admin,
    )
    const login = { user: owner, password }
    const bootstrap = connect({ ...login, database: connections.maintenanceDatabase })
    try {
        // What THIS server gives a non-superuser for a role it creates, measured rather than assumed: the
        // owner creates a throwaway role, and its own membership in it is read back. On Postgres 16+ with
        // `createrole_self_grant` unset, that is ADMIN, and neither INHERIT nor SET.
        const probe = `${owner}_probe`
        await sql`CREATE ROLE ${sql.id(probe)} NOLOGIN`.execute(bootstrap)
        const creator = await sql<{ admin_option: boolean; inherit_option: boolean; set_option: boolean }>`
            SELECT m.admin_option, m.inherit_option, m.set_option FROM pg_auth_members m
            WHERE m.roleid = ${probe}::regrole AND m.member = current_user::regrole`.execute(bootstrap)
        expect(creator.rows.length).toBe(1)
        expect(creator.rows[0]!.admin_option).toBe(true)
        expect(creator.rows[0]!.inherit_option).toBe(false)
        expect(creator.rows[0]!.set_option).toBe(false)
        await sql`DROP ROLE ${sql.id(probe)}`.execute(bootstrap)

        // `app_user` is cluster-wide. On a fresh server the owner's own migration 0001 creates it, and the
        // owner gets the creator's membership just measured. On a server where another pass already
        // created it, the owner is granted EXACTLY that membership, so it stands where Aurora's master
        // user stands after creating app_user either way.
        const existing = await sql<{
            n: number
        }>`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = 'app_user'`.execute(admin)
        if (existing.rows[0]!.n > 0) {
            await sql`GRANT app_user TO ${sql.id(owner)} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`.execute(admin)
        }

        await sql`CREATE DATABASE ${sql.id(database)}`.execute(bootstrap)
    } finally {
        await bootstrap.destroy()
    }

    const ownerDb = connect({ ...login, database })
    const superDb = connect({ ...connections.superuser, database })
    try {
        // The pass proves what it says only if the owner really is no superuser and cannot bypass RLS.
        const self = await sql<{ rolsuper: boolean; rolbypassrls: boolean }>`
            SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`.execute(ownerDb)
        expect(self.rows[0]!.rolsuper).toBe(false)
        expect(self.rows[0]!.rolbypassrls).toBe(false)

        await migrateToLatest(ownerDb)

        // The failure itself, named: inside withTenant the owner IS app_user, in the tenant it asked for.
        const [tenant] = await superDb
            .insertInto('tenants')
            .values({ slug: `owner-pass-${stamp}`, name: 'Owner Pass' })
            .returning('id')
            .execute()
        const inside = await runWithTenant(ownerDb, tenant!.id, (trx) =>
            sql<{ role: string; tenant: string }>`
                SELECT current_user AS role, current_setting('app.current_tenant', true) AS tenant`.execute(trx),
        )
        expect(inside.rows[0]!.role).toBe('app_user')
        expect(inside.rows[0]!.tenant).toBe(tenant!.id)

        // ...and the whole composed proof suite, every role switch made by the owner.
        await runRlsProofs(superDb, expect, { appDb: ownerDb })
    } finally {
        await ownerDb.destroy()
        await superDb.destroy()
        // Best effort: a failed teardown must not mask the result, and the servers it runs on are throwaway.
        await sql`DROP DATABASE IF EXISTS ${sql.id(database)} WITH (FORCE)`.execute(admin).catch(() => undefined)
        await sql`DROP ROLE IF EXISTS ${sql.id(owner)}`.execute(admin).catch(() => undefined)
    }
}
