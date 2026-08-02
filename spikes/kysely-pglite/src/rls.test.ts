import { beforeAll, describe, expect, test } from 'vitest'
import { sql, type Kysely } from 'kysely'
import { createTestDb } from './db.js'
import { withTenant } from './with-tenant.js'
import type { DB } from './schema.js'

let db: Kysely<DB>
let alpha: string
let demo: string

beforeAll(async () => {
    db = await createTestDb()
    const tenants = await db
        .insertInto('tenants')
        .values([{ slug: 'alpha' }, { slug: 'demo-org' }])
        .returning(['id', 'slug'])
        .execute()
    alpha = tenants.find((t) => t.slug === 'alpha')!.id
    demo = tenants.find((t) => t.slug === 'demo-org')!.id
    await db
        .insertInto('notes')
        .values([
            { tenant_id: alpha, body: 'alpha note 1' },
            { tenant_id: alpha, body: 'alpha note 2' },
            { tenant_id: demo, body: 'demo note 1' },
        ])
        .execute()
})

describe('row-level security through Kysely on pglite', () => {
    test('unfiltered reads see only the scoped tenant (alpha)', async () => {
        const rows = await withTenant(db, alpha, (trx) => trx.selectFrom('notes').selectAll().execute())
        expect(rows).toHaveLength(2)
        expect(rows.every((r) => r.tenant_id === alpha)).toBe(true)
    })

    test('unfiltered reads see only the scoped tenant (demo-org)', async () => {
        const rows = await withTenant(db, demo, (trx) => trx.selectFrom('notes').selectAll().execute())
        expect(rows).toHaveLength(1)
        expect(rows[0]!.tenant_id).toBe(demo)
    })

    test('negative control: superuser without SET ROLE bypasses RLS and sees everything', async () => {
        // Proves the isolation tests above are not passing vacuously: pglite's default user is a
        // BYPASSRLS superuser, and FORCE does not override that — only SET ROLE does.
        const rows = await db.selectFrom('notes').selectAll().execute()
        expect(rows).toHaveLength(3)
    })

    test('fail-closed: role set but no tenant context yields zero rows', async () => {
        const rows = await db.transaction().execute(async (trx) => {
            await sql`SET LOCAL ROLE app_user`.execute(trx)
            return trx.selectFrom('notes').selectAll().execute()
        })
        expect(rows).toHaveLength(0)
    })

    test('write isolation: INSERT carrying another tenant id is rejected by WITH CHECK', async () => {
        await expect(
            withTenant(db, alpha, (trx) =>
                trx.insertInto('notes').values({ tenant_id: demo, body: 'smuggled' }).execute(),
            ),
        ).rejects.toThrow(/row-level security/)
    })

    test('writes within the scoped tenant succeed and are visible', async () => {
        await withTenant(db, alpha, (trx) =>
            trx.insertInto('notes').values({ tenant_id: alpha, body: 'alpha note 3' }).execute(),
        )
        const rows = await withTenant(db, alpha, (trx) => trx.selectFrom('notes').selectAll().execute())
        expect(rows).toHaveLength(3)
    })
})
