import { Kysely, sql } from 'kysely'

/**
 * Lets the role that runs the migrations SWITCH to `app_user`, which every `withTenant` does
 * (`SET LOCAL ROLE app_user`, ../with-tenant.ts; ADR-0004 addendum, 2026-11-16).
 *
 * WHY. 0001 creates `app_user` and never grants it to anyone. A superuser needs no grant, and every
 * gate this repo had connected as one. Aurora's master user is `NOSUPERUSER CREATEROLE`, and since
 * Postgres 16 a non-superuser that creates a role is granted ADMIN on it but NOT SET (unless
 * `createrole_self_grant` says otherwise; by default it is empty). So the owner that ran every migration
 * could not switch to the role it had created, and every tenant-scoped query failed closed with
 * `permission denied to set role "app_user"`.
 *
 * WHAT IT GRANTS: `SET TRUE`, the one thing `withTenant` needs. `INHERIT FALSE` on purpose: this role
 * OWNS every table it migrated, so app_user's privileges add nothing it needs, and inheriting them would
 * quietly hand it every grant made to app_user later. (A SEPARATE application role is a different case:
 * see `db-role-not-superuser` in docs/cutover-checklist.md.)
 *
 * SAFE TO RUN ANYWHERE:
 * - it names the two roles it touches and nothing else (the order-independence rule in ./index.ts);
 * - a superuser (CI's, pglite's) can already switch to any role, so `pg_has_role(..., 'SET')` is true and
 *   nothing is granted;
 * - re-running it grants nothing either, for the same reason.
 * A role with no ADMIN on app_user (it did not create it, and nobody gave it the option) cannot grant
 * itself the switch. Then the migration fails, and says what to run.
 */
export async function up(db: Kysely<any>): Promise<void> {
    await sql`
        DO $$
        BEGIN
            IF NOT pg_has_role(current_user, 'app_user', 'SET') THEN
                GRANT app_user TO CURRENT_USER WITH SET TRUE, INHERIT FALSE;
            END IF;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE EXCEPTION 'keel: role % cannot switch to app_user, and cannot grant itself that (it holds no ADMIN on app_user). As a role that does, run: GRANT app_user TO % WITH SET TRUE, INHERIT FALSE', current_user, current_user;
        END $$
    `.execute(db)
}

/**
 * Deliberately grants nothing back and revokes nothing. Taking the switch away again would make every
 * `withTenant` fail closed for the role that runs the app, and keel never runs `down` migrations.
 */
export async function down(): Promise<void> {}
