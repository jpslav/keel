import { ExecuteStatementCommand } from '@aws-sdk/client-rds-data'
import EmbeddedPostgres from 'embedded-postgres'
import { sql, type Kysely } from 'kysely'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { portFor } from '../../../../../scripts/ports.mjs'
import { makeTestTmpDir } from '../../../../../tests/support/tmp-dir'
import { runRlsProofs } from '../../db/rls-proof-runner'
import type { DB } from '../../db/schema'
import type { DbPort } from '../../ports/db'
import { createRealDataApiDb, createRealDb } from './db'
import { RdsDataDatabaseError, RdsDataUnsupportedError } from './rds-data-codec'
import { RdsDataEmulator } from './rds-data-emulator'

/**
 * keel's proofs THROUGH the RDS Data API driver (ADR-0002, addendum 2026-11-16): the dialect in
 * ./rds-data-dialect.ts, talking to ./rds-data-emulator.ts, which runs every call on real Postgres with
 * the Data API's documented semantics — and its strictness, which is what the two negative controls at
 * the bottom prove. What this cannot prove is AWS's own wire format; the `data-api` cutover row does that.
 *
 * Its own database, `keel_data_api_contract`, migrated THROUGH the dialect (so the migrator's
 * one-transaction run is part of what passes), beside keel's `pg` contract run (./db.contract.test.ts).
 */

const DATABASE = 'keel_data_api_contract'
const RESOURCE_ARN = 'arn:aws:rds:us-east-1:000000000000:cluster:emulated'
const SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:000000000000:secret:emulated'

let embedded: InstanceType<typeof EmbeddedPostgres> | null = null
let emulator: RdsDataEmulator
let dataApi: DbPort
let viaPg: DbPort
let migrationCalls: string[] = []

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
        await sql`CREATE DATABASE ${sql.id(DATABASE)}`.execute(server)
    } catch (error) {
        if (!/already exists/.test(String(error))) throw error
    } finally {
        await server.destroy()
    }

    const url = new URL(serverUrl)
    url.pathname = `/${DATABASE}`
    emulator = new RdsDataEmulator(url.toString())
    dataApi = createRealDataApiDb({ resourceArn: RESOURCE_ARN, secretArn: SECRET_ARN, database: DATABASE, client: emulator })
    await dataApi.migrateToLatest()
    migrationCalls = emulator.calls.map((call) => call.operation)
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
    test('the migrator ran every migration inside a Data API transaction', () => {
        expect(migrationCalls).toContain('BeginTransaction')
        expect(migrationCalls).toContain('CommitTransaction')
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
        const transactionIds = new Set(calls.filter((c) => c.operation === 'ExecuteStatement').map((c) => c.transactionId))
        expect(calls[0]!.operation).toBe('BeginTransaction')
        expect(calls.at(-1)!.operation).toBe('CommitTransaction')
        expect([...transactionIds]).toEqual([calls[0]!.transactionId])

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

    test('a unique violation carries code 23505 and its constraint, as node-postgres errors do', async () => {
        const slug = `dup-${Date.now()}`
        await db().insertInto('tenants').values({ slug, name: 'first' }).execute()
        const error = await db()
            .insertInto('tenants')
            .values({ slug, name: 'second' })
            .execute()
            .then(() => null, (e: unknown) => e)
        expect(error).toBeInstanceOf(RdsDataDatabaseError)
        expect((error as RdsDataDatabaseError).code).toBe('23505')
        expect((error as RdsDataDatabaseError).constraint).toBe('tenants_slug_key')
    })

    test('every column type keel uses reads back exactly as through the pg driver', async () => {
        await sql`
            create table if not exists data_api_parity (
                k text primary key, u uuid, t text, j jsonb, ja jsonb, ts timestamptz, d date, da date[],
                ta text[], ua uuid[], i int4, big int8, n numeric, f float8, b boolean, by bytea, nothing uuid
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
        }
        const insert = (port: DbPort, k: string) =>
            sql`insert into data_api_parity values (${k}, ${values.u}, ${values.t}, ${values.j}, ${values.ja},
                ${values.ts}, ${values.d}, ${values.da}, ${values.ta}, ${values.ua}, ${values.i}, ${values.big},
                ${values.n}, ${values.f}, ${values.b}, ${values.by}, ${values.nothing})
                on conflict (k) do nothing`.execute(port.getDb())
        await insert(dataApi, 'written-via-data-api')
        await insert(viaPg, 'written-via-pg')

        const read = (port: DbPort) =>
            sql<Record<string, unknown>>`
                select *, (select count(*) from data_api_parity) as total
                from data_api_parity where u = ${values.u} and t = any(${[values.t, 'other']}) order by k`.execute(
                port.getDb(),
            )
        const fromDataApi = (await read(dataApi)).rows
        const fromPg = (await read(viaPg)).rows
        expect(fromDataApi).toHaveLength(2)
        expect(fromDataApi).toEqual(fromPg)
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
})
