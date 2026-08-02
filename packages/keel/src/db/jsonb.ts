import { sql, type RawBuilder } from 'kysely'

/**
 * Serialize a JS value for a `jsonb` column parameter, engine-safe on BOTH pglite and node-postgres.
 *
 * node-postgres serializes a JS ARRAY as a Postgres ARRAY literal (`{a,b}`), NOT as JSON — so inserting
 * an array straight into a jsonb column throws `invalid input syntax for type json` on real Postgres,
 * even though pglite happens to accept it. That is the same "a raw shape only *appears* to work on
 * pglite" trap the build notes record for FORCE-RLS scans (docs/build-notes.md): the unit test (pglite)
 * would pass while the contract test (embedded Postgres via `pg`) breaks. Passing a JSON string with an
 * explicit `::jsonb` cast is unambiguous on both engines.
 *
 * Plain OBJECTS don't need this (node-postgres JSON.stringifies them — jobs.payload / schedules.spec
 * rely on that), but ARRAYS do. Use this for any array-valued jsonb column (webhook_endpoints.event_kinds).
 */
export function jsonb<T>(value: T): RawBuilder<T> {
    return sql<T>`${JSON.stringify(value)}::jsonb`
}
