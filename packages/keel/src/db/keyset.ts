import { sql, type SelectQueryBuilder, type SqlBool, type Transaction } from 'kysely'
import {
    type KeysetCursorParse,
    type KeysetPosition,
    clampKeysetLimit,
    encodeKeysetCursor,
    parseKeysetCursor,
} from '../core/keyset'
import type { DbPort } from '../ports/db'
import type { DB } from './schema'

/**
 * Keyset pagination over a tenant-scoped table — the SQL half of `keel/core/keyset` (which carries
 * the cursor grammar, the offset-vs-keyset argument, and the reason a cursor cannot widen a scope).
 *
 * This is a FRAMEWORK primitive rather than app code for the same reason `withTenant` is: a paginated
 * read of a tenant-scoped table has a correctness property that must not be re-derived per list. Three
 * things go wrong when a list hand-rolls its own paging, and all three are invisible until production:
 *
 *  1. **The scope is dropped on page 2.** The classic shape is a first query built from session state
 *     and a second built from the cursor — and the second forgets the org filter. Here the app cannot
 *     make that mistake, because there is only ever ONE query: `keysetPage` opens the `withTenant`
 *     transaction itself and the caller's `build` callback (which carries the org filter) runs on
 *     every page, cursor or no cursor. The cursor is an extra conjunct on that same query, never a
 *     query of its own.
 *  2. **The ordering is not total.** `ORDER BY created_at DESC` alone is not an order: every row
 *     written in one transaction shares the identical `now()`, so the database is free to return them
 *     in any order and a cursor into the middle of the batch is meaningless. The tiebreak on the
 *     primary key is what makes the walk well-defined.
 *  3. **The position loses precision.** `timestamptz` is microsecond-precision; the JS `Date` the
 *     driver hands back is millisecond-precision. Minting the cursor from that `Date` truncates it,
 *     and the next page's `created_at < cursor` then also excludes every row written inside the same
 *     millisecond — silently dropping rows, or (for a batch that shares one timestamp) returning an
 *     empty page 2 forever. So the pager never re-derives the position: it asks POSTGRES to render
 *     the ordering key it just read, at full precision, and puts that string in the cursor.
 *
 * The page predicate is a row-value comparison, `(created_at, id) < ($1, $2)`, which is both the
 * exact meaning of "strictly after this position in `created_at DESC, id DESC`" and the form Postgres
 * can satisfy from an index on `(…, created_at DESC, id DESC)` — see
 * each app’s own `1004_*_keyset_index` migration for the index a paged table wants.
 *
 * **Ordering by another column.** `created_at` is the default ordering key, and the optional trailing
 * `orderBy` argument swaps it for any other NOT NULL `timestamptz` column of the paged table — a list
 * that wants "most recently touched first", say. It replaces the key in all three places the pager
 * uses it (the row-value comparison, the cursor's rendered position, and the `ORDER BY`), because a
 * cursor is only correct when those three agree. Everything else is untouched: `withTenant` on every
 * page, the `id` tiebreak, the full-precision cursor, the one-extra-row probe, and the server-side
 * clamp. Leave `orderBy` out and the SQL is exactly what it was before the argument existed.
 *
 * **What a cursor does not say.** `keel/core/keyset`'s cursor grammar is `at` + `id` and nothing
 * else — it names no column. A cursor minted while paging by one column is therefore
 * indistinguishable from one minted while paging by another, and replaying it under the wrong
 * ordering is not rejected: it is read as a position in THAT ordering and quietly skips or repeats
 * rows. So the ordering must never be something the client chooses. Each list route owns ONE fixed
 * ordering, picked server-side when the route is written. A route that wants to offer its caller a
 * choice of orderings has to make that choice at the route level — separate routes, or separate
 * server-side functions each passing its own `orderBy` — not carry it in the cursor or in a request
 * parameter that reaches this function. The rest of the cursor contract is unchanged: the parser is
 * total (`invalid` becomes a 400), the page size is clamped on the server, and every page is scoped
 * the same.
 */

/**
 * The tables this pager can page: those with both an `id` and a `created_at`. Structural, not a
 * hand-kept list, so an app table registered through the seam (`@app-config/db/schema`) qualifies
 * automatically and a table without an ordering key is rejected by the compiler rather than by a
 * runtime SQL error.
 */
export type KeysetTableName = {
    [K in keyof DB & string]: DB[K] extends { id: unknown; created_at: unknown } ? K : never
}[keyof DB & string]

/**
 * The columns of table `TB` that `keysetPage` accepts as its `orderBy`: those declared NOT NULL.
 *
 * A nullable ordering column would be a silent trap. The page predicate is a row-value comparison,
 * `(col, id) < (x, y)`, and once `col` is NULL that comparison is never true — so rows with a NULL
 * key would drop out of the walk after the first page rather than raising anything. Excluding
 * nullable columns turns that into a compile error.
 *
 * What the types cannot say is that the column is a `timestamptz`: the schema has no nominal
 * timestamp type, so `created_at: Generated<string>` is the same TypeScript type as a text column
 * such as `JobsTable.status`, and this type admits both. That half is enforced at the SQL boundary
 * instead. The column goes in through `sql.ref` — a quoted identifier, never an interpolated string —
 * and is then fed to `to_char(… at time zone 'UTC', …)` and compared against a `::timestamptz`
 * parameter, so naming a non-timestamp column fails with a Postgres type error on the first page.
 * It is loud, not a silently wrong order.
 */
export type KeysetOrderColumn<TB extends KeysetTableName> = {
    [K in keyof DB[TB] & string]: null extends DB[TB][K] ? never : K
}[keyof DB[TB] & string]

/** One page, plus the token for the next one (null when this page is the last). */
export interface KeysetPage<TRow> {
    rows: TRow[]
    nextCursor: string | null
}

/** Postgres's own id shape (`gen_random_uuid()`), which every table in this schema uses. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `parseKeysetCursor` plus the one constraint only this layer knows about: the id half is bound to a
 * `uuid`, so an id that is not one can never be a real row here and is rejected at the boundary
 * rather than becoming a cast error (a 500, and a probe signal) inside the query. Routes over SQL
 * tables should use THIS, not the core parser; an in-memory twin uses the core one, whose row handles
 * are not uuids.
 */
export function parseDbKeysetCursor(raw: string | null | undefined): KeysetCursorParse {
    const parsed = parseKeysetCursor(raw)
    if (parsed.kind === 'after' && !UUID_PATTERN.test(parsed.position.id)) return { kind: 'invalid' }
    return parsed
}

/**
 * Reads one page of `build`'s query, newest-first (by `created_at`, or by `orderBy` when given),
 * inside a tenant-scoped transaction.
 *
 * `build` supplies the table, the columns, and the APP-LEVEL scope (the org filter, the two-sided
 * one, whatever the table's boundary is). It must select `id`. Everything that makes the read a
 * correct PAGE — the total order, the cursor predicate, the capped limit, and the next cursor — is
 * this function's, on every page.
 *
 * `limit` is clamped here as well as at the route: the cap is a property of the primitive, not a
 * discipline the caller has to remember.
 *
 * `orderBy` (optional, last) names a NOT NULL timestamptz column to order by instead of `created_at`;
 * see the file header for what it changes and why it must be fixed per route, never client-chosen.
 * Type inference note: pass `orderBy` with a `build` whose parameter is typed (a named function, or
 * `(trx: Transaction<DB>) => …`). With an inline arrow whose `trx` is left to be inferred, TypeScript
 * has to settle `TB` while checking the literal `orderBy` — before `build` has been read — and falls
 * back to the whole `KeysetTableName` bound, which then rejects `build`'s return type.
 *
 * Two things `build` must NOT do. It must not add its own `orderBy` — the total order is what makes the
 * cursor mean anything, and a caller's ordering would silently take precedence over it. And it should
 * select the columns it wants rather than `selectAll()`, because the returned rows also carry the
 * pager's internal `keyset_at` column; map to a view before anything reaches a client (the callers here
 * all do). The ordering column and `id` are referenced UNQUALIFIED, so a `build` that joins another table
 * carrying a column of the same name gets Postgres's "column reference is ambiguous".
 */
export async function keysetPage<TB extends KeysetTableName, O extends { id: string }>(
    db: DbPort,
    request: { tenantId: string; after: KeysetPosition | null; limit: number },
    build: (trx: Transaction<DB>) => SelectQueryBuilder<DB, TB, O>,
    orderBy?: KeysetOrderColumn<TB>,
): Promise<KeysetPage<O>> {
    const limit = clampKeysetLimit(request.limit)
    const after = request.after
    // ONE reference to the ordering column, used by the comparison, the cursor rendering and the
    // ORDER BY below. `sql.ref` quotes it as an identifier; the type already restricted it to a real
    // column of `TB`, and nothing from a request ever reaches it.
    const orderColumn = (orderBy ?? 'created_at') as KeysetOrderColumn<TB>
    const orderRef = sql.ref(orderColumn)
    return db.withTenant(request.tenantId, async (trx) => {
        // The caller's scope, applied on EVERY page — this is the query, not a first-page-only one.
        const scoped = build(trx)
        // The cursor can only ADD a conjunct to it. Both halves are bound parameters, and both were
        // pattern-checked before they got here (parseDbKeysetCursor).
        const windowed = after
            ? scoped.where(sql<SqlBool>`(${orderRef}, id) < (${after.at}::timestamptz, ${after.id}::uuid)`)
            : scoped
        // One extra row is the "is there a next page" probe — cheaper and race-free compared with a
        // COUNT(*), which would be a second query against a moving table.
        const probed = await windowed
            .select(
                sql<string>`to_char(${orderRef} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as('keyset_at'),
            )
            .orderBy(orderRef, 'desc')
            .orderBy(sql`id`, 'desc')
            .limit(limit + 1)
            .execute()
        const rows = probed.slice(0, limit)
        const last = rows.at(-1)
        return {
            rows,
            nextCursor: probed.length > limit && last ? encodeKeysetCursor({ at: last.keyset_at, id: last.id }) : null,
        }
    })
}
