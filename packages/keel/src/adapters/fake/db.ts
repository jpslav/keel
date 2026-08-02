import { PGlite } from '@electric-sql/pglite'
import { Kysely, type Transaction } from 'kysely'
import { migrateToLatest } from '../../db/migrate'
import type { DB } from '../../db/schema'
import { seedDb } from '../../db/seed'
import { runWithTenant } from '../../db/with-tenant'
import type { DbPort } from '../../ports/db'
import { dataDir } from './data-dir'
import { fakeEmail } from './email'
import { PGliteDialect } from './pglite-dialect'
import { fakeStorage } from './storage'

// Survive Next dev hot-reload: keep the single pglite instance on globalThis. The raw client is
// cached alongside db/ready (not just derivable from `db`) so closeFakeDb() below can actually
// close it — Kysely's own PGliteDriver.destroy() is a no-op (see pglite-dialect.ts).
const globalStore = globalThis as unknown as {
    __appFakeDb?: { db: Kysely<DB>; ready: Promise<void>; client: PGlite }
}

function instance() {
    if (!globalStore.__appFakeDb) {
        // Persisted under .data so dev data survives restarts; delete .data/pglite to reset.
        const client = new PGlite(dataDir('pglite'))
        const db = new Kysely<DB>({ dialect: new PGliteDialect(client) })
        // Seeding is a FAKE-mode concern (real deployments migrate but never seed), so the fake
        // adapters are the natural place to hand the seeder the storage and email it needs to furnish
        // a world: an app's seeded attachments need bytes, and its opening state may include mail.
        const ready = migrateToLatest(db).then(() => seedDb(db, { storage: fakeStorage, email: fakeEmail }))
        globalStore.__appFakeDb = { db, ready, client }
    }
    return globalStore.__appFakeDb
}

/**
 * Closes the cached pglite client and drops the global cache (simulated-mode-only, used by Simulator's
 * Snapshots reset/save/restore — packages/keel/src/adapters/fake/simulator-admin.ts — before touching `.data/pglite`
 * on disk). No-op if nothing has been created yet. Awaits `ready` first so a migration/seed in
 * flight always finishes before the client closes underneath it — its rejection is swallowed
 * (an already-failed migration shouldn't block the close) but never skipped. `client.close()`'s
 * rejection is swallowed too: this is the ONE step that must not leave the global cache stuck
 * pointing at a client that failed to close cleanly — a caller (Snapshots reset/restore) that can't
 * drop its old pglite handle can never get a working fresh one either, since `instance()` only
 * re-creates when the cache slot is empty. Because `instance()` is lazy, the very next call
 * re-creates, re-migrates, and re-seeds a fresh pglite instance — no server restart needed.
 */
export async function closeFakeDb(): Promise<void> {
    const store = globalStore.__appFakeDb
    if (!store) return
    await store.ready.catch(() => {})
    await store.client.close().catch(() => {})
    delete globalStore.__appFakeDb
}

export const fakeDb: DbPort = {
    getDb() {
        return instance().db
    },
    async ready() {
        await instance().ready
    },
    async withTenant<T>(tenantId: string, fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
        const { db, ready } = instance()
        await ready
        return runWithTenant(db, tenantId, fn)
    },
    async migrateToLatest() {
        await instance().ready
    },
}
