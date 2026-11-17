import { ExecuteStatementCommand } from '@aws-sdk/client-rds-data'
import EmbeddedPostgres from 'embedded-postgres'
import { AbortedTransactionError, sql, type Kysely } from 'kysely'
import { Migrator } from 'kysely/migration'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { portFor } from '../../../../../scripts/ports.mjs'
import { makeTestTmpDir } from '../../../../../tests/support/tmp-dir'
import { runRlsProofs } from '../../db/rls-proof-runner'
import type { DB } from '../../db/schema'
import type { DbPort } from '../../ports/db'
import { createRealDb } from './db'
import { createRealDataApiDb } from './db-data-api'
import { RdsDataDatabaseError, RdsDataUnsupportedError } from './rds-data-codec'
import { RdsDataEmulator, type EmulatedCall } from './rds-data-emulator'

/**
 * keel's proofs THROUGH the RDS Data API driver (ADR-0002, addendum 2026-11-16): the dialect in
 * ./rds-data-dialect.ts, talking to ./rds-data-emulator.ts, which runs every call on real Postgres with
 * the Data API's documented semantics — and its strictness, which is what the four negative controls at
 * the bottom prove. What this cannot prove is AWS's own wire format; the `data-api` cutover row does that.
 *
 * Its own database, `keel_data_api_contract`, migrated THROUGH the dialect (so the migrator's
 * one-transaction run is part of what passes), beside keel's `pg` contract run (./db.contract.test.ts).
 */

const DATABASE = 'keel_data_api_contract'
/** A second, empty database: two migrators race on it to prove the migration lock. */
const LOCK_DATABASE = 'keel_data_api_lock'
const RESOURCE_ARN = 'arn:aws:rds:us-east-1:000000000000:cluster:emulated'
const SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:000000000000:secret:emulated'

let embedded: InstanceType<typeof EmbeddedPostgres> | null = null
let emulator: RdsDataEmulator
let dataApi: DbPort
let viaPg: DbPort
let migrationCalls: EmulatedCall[] = []
let databaseUrl: (name: string) => string

beforeAll(async () => {
    let serverUrl = process.env.CONTRACT_DATABASE_URL
    if (!serverUrl) {
        const port = portFor('contractPg')
        embedded = new EmbeddedPostgres({
            databaseDir: makeTestTmpDir('keel-data-api-pg-'),
            user: 'postgres',
            password: 'postgres',
            port,
            persistent: false,
        })
        await embedded.initialise()
        await embedded.start()
        serverUrl = `postgres://postgres:postgres@localhost:${port}/postgres`
    }

    const server = createRealDb(serverUrl).getDb()
    try {
        // The lock database must start empty every run (a reused live server would otherwise hand it over
        // already migrated, and the race below would prove nothing).
        await sql`DROP DATABASE IF EXISTS ${sql.id(LOCK_DATABASE)}`.execute(server)
        await sql`CREATE DATABASE ${sql.id(LOCK_DATABASE)}`.execute(server)
        await sql`CREATE DATABASE ${sql.id(DATABASE)}`.execute(server)
    } catch (error) {
        if (!/already exists/.test(String(error))) throw error
    } finally {
        await server.destroy()
    }

    const base = serverUrl
    databaseUrl = (name: string) => {
        const url = new URL(base)
        url.pathname = `/${name}`
        return url.toString()
    }
    const url = new URL(databaseUrl(DATABASE))
    emulator = new RdsDataEmulator(url.toString())
    dataApi = createRealDataApiDb({
        resourceArn: RESOURCE_ARN,
        secretArn: SECRET_ARN,
        database: DATABASE,
        client: emulator,
    })
    await dataApi.migrateToLatest()
    migrationCalls = [...emulator.calls]
    viaPg = createRealDb(url.toString())
}, 120_000)

afterAll(async () => {
    await dataApi?.getDb().destroy()
    await viaPg?.getDb().destroy()
    await emulator?.close()
    await embedded?.stop()
})

const db = (): Kysely<DB> => dataApi.getDb()

/** The calls made by `fn`, as `operation` names (and SQL heads, for statements). */
async function callsDuring(fn: () => Promise<unknown>): Promise<typeof emulator.calls> {
    const from = emulator.calls.length
    await fn().catch(() => undefined)
    return emulator.calls.slice(from)
}

describe('keel on the RDS Data API driver (contract, through the emulator)', () => {
    test('the migrator ran every migration in ONE Data API transaction, holding a transaction-scoped lock', () => {
        const operations = migrationCalls.map((call) => call.operation)
        expect(operations.filter((op) => op === 'BeginTransaction')).toHaveLength(1)
        expect(operations.at(-1)).toBe('CommitTransaction')
        const transactionId = migrationCalls[0]!.transactionId
        expect(migrationCalls.every((call) => call.transactionId === transactionId)).toBe(true)
        // Kysely's own lock is a session-level pg_advisory_lock on a separate connection, which the Data
        // API's connection reset would drop at once; here the lock is transaction-scoped and comes FIRST.
        expect(migrationCalls[1]!.sql).toMatch(/pg_advisory_xact_lock/)
        const locks = migrationCalls.filter((call) => /advisory/.test(call.sql ?? ''))
        expect(locks.every((call) => /pg_advisory_xact_lock/.test(call.sql!))).toBe(true)
    })

    test('two migrators racing on an empty database are serialised by that lock', async () => {
        const racers = [
            new RdsDataEmulator(databaseUrl(LOCK_DATABASE)),
            new RdsDataEmulator(databaseUrl(LOCK_DATABASE)),
        ]
        const ports = racers.map((client) =>
            createRealDataApiDb({ resourceArn: RESOURCE_ARN, secretArn: SECRET_ARN, database: LOCK_DATABASE, client }),
        )
        try {
            await Promise.all(ports.map((port) => port.migrateToLatest()))
            const duplicates = await sql<{ name: string }>`
                select name from kysely_migration group by name having count(*) > 1`.execute(ports[0]!.getDb())
            expect(duplicates.rows).toEqual([])
        } finally {
            for (const port of ports) await port.getDb().destroy()
            for (const racer of racers) await racer.close()
        }
    })

    test('the full RLS proof suite passes through the Data API', async () => {
        await runRlsProofs(db(), expect)
    })

    test('withTenant is ONE transaction: the role and the tenant reach every statement until Commit', async () => {
        const [tenant] = await db()
            .insertInto('tenants')
            .values({ slug: `guc-${Date.now()}`, name: 'GUC proof' })
            .returning('id')
            .execute()
        let seen: { role: string; tenant: string }[] = []
        // Warm the dialect's parameter-type cache, so what is counted below is withTenant's own cost.
        await dataApi.withTenant(tenant!.id, async () => undefined)
        const calls = await callsDuring(async () => {
            seen = await dataApi.withTenant(tenant!.id, async (trx) => {
                const first = await sql<{
                    role: string
                    tenant: string
                }>`select current_user as role, current_setting('app.current_tenant', true) as tenant`.execute(trx)
                const second = await sql<{
                    role: string
                    tenant: string
                }>`select current_user as role, current_setting('app.current_tenant', true) as tenant`.execute(trx)
                return [first.rows[0]!, second.rows[0]!]
            })
        })
        expect(seen).toEqual([
            { role: 'app_user', tenant: tenant!.id },
            { role: 'app_user', tenant: tenant!.id },
        ])
        const transactionIds = new Set(
            calls.filter((c) => c.operation === 'ExecuteStatement').map((c) => c.transactionId),
        )
        expect(calls[0]!.operation).toBe('BeginTransaction')
        expect(calls.at(-1)!.operation).toBe('CommitTransaction')
        expect([...transactionIds]).toEqual([calls[0]!.transactionId])
        // Begin, ONE statement setting both the role and the tenant, the two selects, Commit: every Data API
        // statement is an HTTPS call, so the setup is one call, not two (with-tenant.ts).
        expect(calls.map((c) => c.operation)).toEqual([
            'BeginTransaction',
            'ExecuteStatement',
            'ExecuteStatement',
            'ExecuteStatement',
            'CommitTransaction',
        ])

        // ...and none of it outlives the transaction: the next call is back to the migration user,
        // with no tenant set (an unset custom GUC reads as NULL, or '' once a session has ever set it).
        const after = await sql<{ role: string; tenant: string | null }>`
            select current_user as role, current_setting('app.current_tenant', true) as tenant`.execute(db())
        expect(after.rows[0]!.role).not.toBe('app_user')
        expect(['', null]).toContain(after.rows[0]!.tenant)
    })

    test('a throw inside a transaction rolls the Data API transaction back, and its writes with it', async () => {
        const calls = await callsDuring(() =>
            dataApi.withTenant('00000000-0000-0000-0000-000000000000', async (trx) => {
                await sql`select 1`.execute(trx)
                throw new Error('boom')
            }),
        )
        expect(calls[0]!.operation).toBe('BeginTransaction')
        expect(calls.at(-1)!.operation).toBe('RollbackTransaction')

        const inside = `rollback-trx-${Date.now()}`
        await expect(
            db()
                .transaction()
                .execute(async (trx) => {
                    await trx.insertInto('tenants').values({ slug: inside, name: 'rolled back' }).execute()
                    throw new Error('boom')
                }),
        ).rejects.toThrow('boom')
        const rows = await db().selectFrom('tenants').select('id').where('slug', '=', inside).execute()
        expect(rows).toEqual([])
    })

    test('an EXPLAIN of a parameterised statement is typed by the statement it explains', async () => {
        // PREPARE refuses EXPLAIN, so the describe step asks about the statement alone. Outside a transaction
        // a failed describe throws; inside one it would abort the transaction.
        const plan =
            await sql`explain select * from tenants where id = ${'00000000-0000-0000-0000-000000000000'}`.execute(db())
        expect(plan.rows.length).toBeGreaterThan(0)

        // EXPLAIN ANALYZE runs its statement, so it goes inside a transaction that is then rolled back.
        const slug = `explained-${Date.now()}`
        await expect(
            db()
                .transaction()
                .execute(async (trx) => {
                    await sql`/* tag */ explain analyse insert into tenants (slug, name) values (${slug}, ${'explained'})`.execute(
                        trx,
                    )
                    const seen = await trx.selectFrom('tenants').select('name').where('slug', '=', slug).execute()
                    expect(seen).toEqual([{ name: 'explained' }])
                    throw new Error('undo')
                }),
        ).rejects.toThrow('undo')
        const rows = await db().selectFrom('tenants').select('id').where('slug', '=', slug).execute()
        expect(rows).toEqual([])
    })

    test('a parameterised statement outside a transaction asks Postgres for its types once, then reuses them', async () => {
        // A query shape no other test compiles, so its first run is a guaranteed cache miss.
        const shape = (n: number) =>
            db()
                .selectFrom('tenants')
                .select(sql<string>`id`.as('cache_probe'))
                .where('slug', '=', `cache-probe-${n}`)
                .execute()
        const first = await callsDuring(() => shape(1))
        const second = await callsDuring(() => shape(2))
        expect(first.map((c) => c.operation)).toEqual([
            'BeginTransaction',
            'ExecuteStatement', // PREPARE
            'ExecuteStatement', // read pg_prepared_statements
            'ExecuteStatement', // DEALLOCATE
            'RollbackTransaction',
            'ExecuteStatement', // the statement itself, autocommitted
        ])
        expect(second.map((c) => c.operation)).toEqual(['ExecuteStatement'])
    })

    test('what the Data API cannot do fails loudly instead of silently', async () => {
        await expect(sql`SET ROLE app_user`.execute(db())).rejects.toBeInstanceOf(RdsDataUnsupportedError)
        await expect(sql`select set_config('app.current_tenant', 'x', false)`.execute(db())).rejects.toBeInstanceOf(
            RdsDataUnsupportedError,
        )
        await expect(sql`BEGIN`.execute(db())).rejects.toBeInstanceOf(RdsDataUnsupportedError)
        await expect(async () => {
            for await (const row of db().selectFrom('tenants').selectAll().stream()) void row
        }).rejects.toBeInstanceOf(RdsDataUnsupportedError)
        await expect(sql`select repeat('x', 1100000) as big`.execute(db())).rejects.toThrow(/response size limit/)
    })

    test('a commit that fails keeps its own error, code and all, instead of a rollback complaint', async () => {
        await sql`drop table if exists data_api_deferred`.execute(viaPg.getDb())
        await sql`create table data_api_deferred (
            k text, constraint data_api_deferred_k unique (k) deferrable initially deferred)`.execute(viaPg.getDb())
        const error = await db()
            .transaction()
            .execute(async (trx) => {
                await sql`insert into data_api_deferred values ('same'), ('same')`.execute(trx)
            })
            .then(
                () => null,
                (e: unknown) => e,
            )
        expect(error).toBeInstanceOf(RdsDataDatabaseError)
        expect((error as RdsDataDatabaseError).code).toBe('23505')
        expect((error as RdsDataDatabaseError).constraint).toBe('data_api_deferred_k')
    })

    test('a transaction whose statement failed is reported as aborted, not committed, as on pg', async () => {
        for (const [label, port] of [
            ['pg', viaPg],
            ['data-api', dataApi],
        ] as const) {
            const slug = `aborted-${label}-${Date.now()}`
            const outcome = await port
                .getDb()
                .transaction()
                .execute(async (trx) => {
                    await trx.insertInto('tenants').values({ slug, name: 'lost' }).execute()
                    // caught and carried on: Postgres has aborted the transaction all the same
                    await trx
                        .insertInto('tenants')
                        .values({ slug, name: 'duplicate' })
                        .execute()
                        .catch(() => undefined)
                })
                .then(
                    () => 'reported as committed',
                    (e: unknown) => e,
                )
            expect(outcome, label).toBeInstanceOf(AbortedTransactionError)
            const rows = await db().selectFrom('tenants').select('id').where('slug', '=', slug).execute()
            expect(rows, label).toEqual([])
        }
    })

    test('rolling back to a savepoint recovers the transaction, and the rest of it commits', async () => {
        const slug = `savepoint-${Date.now()}`
        const trx = await db().startTransaction().execute()
        await trx.insertInto('tenants').values({ slug, name: 'kept' }).execute()
        const atSavepoint = await trx.savepoint('before_duplicate').execute()
        await atSavepoint
            .insertInto('tenants')
            .values({ slug, name: 'duplicate' })
            .execute()
            .catch(() => undefined)
        const recovered = await atSavepoint.rollbackToSavepoint('before_duplicate').execute()
        await recovered.commit().execute()
        const rows = await db().selectFrom('tenants').select('name').where('slug', '=', slug).execute()
        expect(rows).toEqual([{ name: 'kept' }])
    })

    test('withTenant’s role and tenant are transaction-local in their own right, not only reset away', async () => {
        // One connection, never reset: whatever outlives a transaction would be seen by the next call. The
        // documented DISCARD ALL would hide a session-level set_config, so this run turns it off.
        const sticky = new RdsDataEmulator(databaseUrl(DATABASE), { resetConnections: false, maxConnections: 1 })
        const port = createRealDataApiDb({
            resourceArn: RESOURCE_ARN,
            secretArn: SECRET_ARN,
            database: DATABASE,
            client: sticky,
        })
        try {
            const [tenant] = await port
                .getDb()
                .insertInto('tenants')
                .values({ slug: `sticky-${Date.now()}`, name: 'sticky' })
                .returning('id')
                .execute()
            await port.withTenant(tenant!.id, async (trx) => {
                await sql`select 1`.execute(trx)
            })
            const after = await sql<{ role: string; tenant: string | null }>`
                select current_user as role, current_setting('app.current_tenant', true) as tenant`.execute(
                port.getDb(),
            )
            expect(after.rows[0]!.role).not.toBe('app_user')
            expect(['', null]).toContain(after.rows[0]!.tenant)
        } finally {
            await port.getDb().destroy()
            await sticky.close()
        }
    })

    test('a Migrator handed the plain db is refused rather than run with a lock that is gone at once', async () => {
        const { error } = await new Migrator({
            db: db(),
            provider: { getMigrations: async () => ({}) },
        }).migrateToLatest()
        expect(error).toBeInstanceOf(RdsDataUnsupportedError)
    })

    test('a unique violation carries code 23505 and its constraint, as node-postgres errors do', async () => {
        const slug = `dup-${Date.now()}`
        await db().insertInto('tenants').values({ slug, name: 'first' }).execute()
        const error = await db()
            .insertInto('tenants')
            .values({ slug, name: 'second' })
            .execute()
            .then(
                () => null,
                (e: unknown) => e,
            )
        expect(error).toBeInstanceOf(RdsDataDatabaseError)
        expect((error as RdsDataDatabaseError).code).toBe('23505')
        expect((error as RdsDataDatabaseError).constraint).toBe('tenants_slug_key')
    })

    test('every column type keel uses is written and read back exactly as through the pg transport', async () => {
        await sql`drop table if exists data_api_parity`.execute(viaPg.getDb())
        await sql`drop domain if exists data_api_code3`.execute(viaPg.getDb())
        await sql`drop domain if exists data_api_short`.execute(viaPg.getDb())
        await sql`create domain data_api_code3 as char(3)`.execute(viaPg.getDb())
        await sql`create domain data_api_short as varchar(3) check (value <> 'bad')`.execute(viaPg.getDb())
        await sql`
            create table data_api_parity (
                k text primary key, u uuid, t text, j jsonb, ja jsonb, ts timestamptz, d date, da date[],
                ta text[], ua uuid[], i int4, big int8, n numeric, f float8, b boolean, by bytea, nothing uuid,
                ch char(3), bi bit(4), cha char(3)[], dc data_api_code3, ds data_api_short
            )`.execute(viaPg.getDb())
        const values = {
            u: '6f1f4f6e-6b1a-4c1e-9d4b-3a1f2c3d4e5f',
            t: 'it\'s "quoted", with a \\ backslash and a :colon',
            j: JSON.stringify({ a: 1, nested: { list: [1, 'two', null] } }),
            ja: JSON.stringify(['x', 2]),
            ts: new Date('2026-11-16T23:04:05.678Z'),
            d: '2026-10-03',
            da: ['2026-10-03', '2026-10-04'],
            ta: ['plain', 'with,comma', 'with "quote"', null],
            ua: ['6f1f4f6e-6b1a-4c1e-9d4b-3a1f2c3d4e5f'],
            i: 42,
            big: '9007199254740993',
            n: '12345.6789',
            f: 1.5,
            b: true,
            by: Buffer.from([0, 1, 2, 255]),
            nothing: null,
            // Postgres prints the inferred type of these as `character` and `bit`, which a CAST reads as
            // length 1: these three catch a value silently truncated on the way in.
            ch: 'abc',
            bi: '1010',
            cha: ['xyz', 'ab'],
            // ...and these two, through a domain walked down to that same base type. They fit, so they do not
            // catch the walk itself going missing: the too-long test below does.
            dc: 'abc',
            ds: 'xyz',
        }
        const insert = (port: DbPort, k: string) =>
            sql`insert into data_api_parity values (${k}, ${values.u}, ${values.t}, ${values.j}, ${values.ja},
                ${values.ts}, ${values.d}, ${values.da}, ${values.ta}, ${values.ua}, ${values.i}, ${values.big},
                ${values.n}, ${values.f}, ${values.b}, ${values.by}, ${values.nothing}, ${values.ch}, ${values.bi},
                ${values.cha}, ${values.dc}, ${values.ds})`.execute(port.getDb())
        await insert(dataApi, 'written-via-data-api')
        await insert(viaPg, 'written-via-pg')

        const read = (port: DbPort) =>
            sql<Record<string, unknown>>`
                select *, (select count(*) from data_api_parity) as total
                from data_api_parity where u = ${values.u} and t = any(${[values.t, 'other']}) and ch = ${values.ch}
                order by k`.execute(port.getDb())
        const fromDataApi = (await read(dataApi)).rows
        const fromPg = (await read(viaPg)).rows
        // READS: both transports return the same two rows identically.
        expect(fromDataApi).toHaveLength(2)
        expect(fromDataApi).toEqual(fromPg)
        // WRITES: the row the Data API wrote is the row pg wrote — so a value encoded wrongly on the way IN
        // (which both transports would then read back the same wrong way) cannot pass.
        const withoutKey = (row: Record<string, unknown>) =>
            Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'k'))
        expect(withoutKey(fromPg[0]!)).toEqual(withoutKey(fromPg[1]!))
    })

    test('a value too long for a domain is refused on both transports, never truncated', async () => {
        // data_api_parity and its domains exist: the parity test above created them.
        for (const [label, port] of [
            ['pg', viaPg],
            ['data-api', dataApi],
        ] as const) {
            // Refused for the same reason on both: the length, or the domain's CHECK. Any refusal would not do,
            // since a Data API call can fail for reasons of its own.
            for (const [column, value, reason] of [
                ['dc', 'abcd', /value too long for type character\(3\)/],
                ['ds', 'wxyz', /value too long for type character varying\(3\)/],
                ['ds', 'bad', /violates check constraint "data_api_short_check"/],
            ] as const) {
                const outcome =
                    await sql`insert into data_api_parity (k, ${sql.ref(column)}) values (${`${label}-${column}-${value}`}, ${value})`
                        .execute(port.getDb())
                        .then(
                            () => 'stored',
                            (e: unknown) => (e instanceof Error ? e.message : String(e)),
                        )
                expect(outcome, `${label}: ${column} = '${value}'`).toMatch(reason)
            }
        }
    })

    test('a raw ROLLBACK TO SAVEPOINT recovers a transaction, as on pg — the only way inside withTenant', async () => {
        for (const [label, port] of [
            ['pg', viaPg],
            ['data-api', dataApi],
        ] as const) {
            const slug = `raw-savepoint-${label}-${Date.now()}`
            await port
                .getDb()
                .transaction()
                .execute(async (trx) => {
                    await trx.insertInto('tenants').values({ slug, name: 'first' }).execute()
                    await sql`savepoint before_duplicate`.execute(trx)
                    await trx
                        .insertInto('tenants')
                        .values({ slug, name: 'duplicate' })
                        .execute()
                        .catch(() => undefined)
                    await sql`rollback to savepoint before_duplicate`.execute(trx)
                    await trx
                        .insertInto('tenants')
                        .values({ slug: `${slug}-after`, name: 'after' })
                        .execute()
                })
            const rows = await db()
                .selectFrom('tenants')
                .select('slug')
                .where('slug', 'in', [slug, `${slug}-after`])
                .orderBy('slug')
                .execute()
            expect(
                rows.map((r) => r.slug),
                label,
            ).toEqual([slug, `${slug}-after`])
        }
    })

    test('a statement refused before any call leaves the transaction usable, so it commits', async () => {
        const slug = `refused-then-commit-${Date.now()}`
        await db()
            .transaction()
            .execute(async (trx) => {
                await trx.insertInto('tenants').values({ slug, name: 'kept' }).execute()
                await sql`COMMIT`.execute(trx).catch((error: unknown) => {
                    expect(error).toBeInstanceOf(RdsDataUnsupportedError)
                })
                // ...nor does one the Data API itself refuses before running it (SQL over 65,536
                // characters; the error's name is the emulator's assumption, checked by step 4 of
                // docs/runbooks/data-api.md)
                await sql`select 1 -- ${sql.raw('x'.repeat(70_000))}`.execute(trx).catch((error: unknown) => {
                    expect((error as Error).name).toBe('ValidationException')
                })
            })
        const rows = await db().selectFrom('tenants').select('name').where('slug', '=', slug).execute()
        expect(rows).toEqual([{ name: 'kept' }])
    })

    test('a parameter after a colon (an array slice) reads as it does on pg', async () => {
        const slice = (port: DbPort) => sql<{ s: number[] }>`select (array[1, 2, 3])[1:${2}] as s`.execute(port.getDb())
        expect((await slice(dataApi)).rows).toEqual((await slice(viaPg)).rows)
        expect((await slice(dataApi)).rows).toEqual([{ s: [1, 2] }])
    })

    // ---- negative controls: the emulator is strict, so the dialect's casts are what made the above pass ----

    test('control: the emulator rejects an untyped string compared with a uuid, as Aurora does', async () => {
        await expect(
            emulator.send(
                new ExecuteStatementCommand({
                    resourceArn: RESOURCE_ARN,
                    secretArn: SECRET_ARN,
                    database: DATABASE,
                    sql: 'select id from tenants where id = :id',
                    parameters: [{ name: 'id', value: { stringValue: '6f1f4f6e-6b1a-4c1e-9d4b-3a1f2c3d4e5f' } }],
                }),
            ),
        ).rejects.toThrow(/uuid = character varying/)
    })

    test('control: the emulator refuses array parameters, as the Data API does', async () => {
        await expect(
            emulator.send(
                new ExecuteStatementCommand({
                    resourceArn: RESOURCE_ARN,
                    secretArn: SECRET_ARN,
                    database: DATABASE,
                    sql: 'select 1 where 1 = any(:xs)',
                    parameters: [{ name: 'xs', value: { arrayValue: { longValues: [1] } } }],
                }),
            ),
        ).rejects.toThrow(/Array parameters are not supported/)
    })

    test('control: the emulator resets every connection, so session state does not survive between calls', async () => {
        const call = (statement: string) =>
            emulator.send(
                new ExecuteStatementCommand({
                    resourceArn: RESOURCE_ARN,
                    secretArn: SECRET_ARN,
                    database: DATABASE,
                    sql: statement,
                    includeResultMetadata: true,
                }),
            ) as Promise<{ records?: { stringValue?: string; isNull?: boolean }[][] }>
        await call("select set_config('keel.probe', 'leaked', false)")
        const after = await call("select current_setting('keel.probe', true) as probe")
        const field = after.records![0]![0]!
        expect(field.isNull === true || field.stringValue === '').toBe(true)
    })

    test('control: the emulator returns database errors without a SQLSTATE, the worst case reported', async () => {
        const error = await emulator
            .send(
                new ExecuteStatementCommand({
                    resourceArn: RESOURCE_ARN,
                    secretArn: SECRET_ARN,
                    database: DATABASE,
                    sql: 'insert into tenants (slug, name) select slug, name from tenants limit 1',
                }),
            )
            .then(
                () => null,
                (e: unknown) => e as Error & { code?: string },
            )
        expect(error?.name).toBe('DatabaseErrorException')
        expect(error?.message).not.toMatch(/SQLState/)
        expect(error?.code).toBeUndefined()
    })
})
