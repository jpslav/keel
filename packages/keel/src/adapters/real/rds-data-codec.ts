import type { ArrayValue, ColumnMetadata, Field, SqlParameter } from '@aws-sdk/client-rds-data'

/**
 * The pure half of the RDS Data API dialect (./rds-data-dialect.ts): SQL rewriting, value encoding,
 * result decoding and error normalization. No I/O, so every rule here is unit-tested directly
 * (./rds-data-codec.test.ts) and the contract suite proves the composition against real Postgres.
 *
 * The one idea everything here serves: keel's SQL is written for node-postgres, which sends each
 * parameter as text with NO type and lets Postgres infer it from context (`id = $1` makes `$1` a uuid).
 * The Data API cannot do that — an untyped string arrives as `varchar`, and `uuid = varchar` is an error
 * on real Aurora. So the dialect asks Postgres what it would have inferred (PREPARE, then
 * `pg_prepared_statements.parameter_types`), and sends every value as a string wrapped in an explicit
 * `CAST(:name AS <that type>)`. That reproduces node-postgres's semantics instead of approximating them
 * with per-value guesses, and it is also what lets an array reach the server at all: the Data API
 * rejects array parameters, but an array literal cast to `uuid[]` is a string.
 */

// ---------------------------------------------------------------------------------------------
// SQL scanning
// ---------------------------------------------------------------------------------------------

const IDENT_CHAR = /[A-Za-z0-9_$\u0080-￿]/

/**
 * Rewrites every `$n` placeholder that is real SQL — not inside a string literal, a quoted identifier,
 * a comment or a dollar-quoted body — with `replace(n)`. Returns the SQL unchanged when it has none.
 *
 * Postgres's own lexical rules, the parts that can hide a `$1`: `'…'` (with `''`), `E'…'` (with
 * backslash escapes as well), `"…"` (with `""`), `--` to end of line, nested block comments, and
 * `$tag$…$tag$`. A `$` directly after an identifier character is part of that identifier, not a
 * placeholder or a dollar quote.
 */
export function rewritePlaceholders(sql: string, replace: (index: number) => string): string {
    let out = ''
    let i = 0
    while (i < sql.length) {
        const ch = sql[i]!
        const next = sql[i + 1]
        const prev = i > 0 ? sql[i - 1]! : ''
        if (ch === '-' && next === '-') {
            const end = sql.indexOf('\n', i)
            const stop = end === -1 ? sql.length : end
            out += sql.slice(i, stop)
            i = stop
        } else if (ch === '/' && next === '*') {
            const stop = blockCommentEnd(sql, i)
            out += sql.slice(i, stop)
            i = stop
        } else if (ch === "'") {
            const escapes = (prev === 'E' || prev === 'e') && !IDENT_CHAR.test(i > 1 ? sql[i - 2]! : '')
            const stop = quotedEnd(sql, i, "'", escapes)
            out += sql.slice(i, stop)
            i = stop
        } else if (ch === '"') {
            const stop = quotedEnd(sql, i, '"', false)
            out += sql.slice(i, stop)
            i = stop
        } else if (ch === '$' && !IDENT_CHAR.test(prev)) {
            const digits = /^\$(\d+)/.exec(sql.slice(i))
            if (digits) {
                out += replace(Number(digits[1]))
                i += digits[0].length
                continue
            }
            const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
            if (tag) {
                const close = sql.indexOf(tag[0], i + tag[0].length)
                const stop = close === -1 ? sql.length : close + tag[0].length
                out += sql.slice(i, stop)
                i = stop
                continue
            }
            out += ch
            i += 1
        } else {
            out += ch
            i += 1
        }
    }
    return out
}

function quotedEnd(sql: string, start: number, quote: string, backslashEscapes: boolean): number {
    let i = start + 1
    while (i < sql.length) {
        const ch = sql[i]!
        if (backslashEscapes && ch === '\\') {
            i += 2
        } else if (ch === quote) {
            if (sql[i + 1] === quote) i += 2
            else return i + 1
        } else {
            i += 1
        }
    }
    return sql.length
}

function blockCommentEnd(sql: string, start: number): number {
    let depth = 0
    let i = start
    while (i < sql.length) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
            depth += 1
            i += 2
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
            depth -= 1
            i += 2
            if (depth === 0) return i
        } else {
            i += 1
        }
    }
    return sql.length
}

/** The statement's first keyword, lower-cased, past leading whitespace, comments and parentheses. */
export function leadingKeyword(sql: string): string {
    let i = 0
    while (i < sql.length) {
        const ch = sql[i]!
        if (/\s|\(/.test(ch)) {
            i += 1
        } else if (ch === '-' && sql[i + 1] === '-') {
            const end = sql.indexOf('\n', i)
            i = end === -1 ? sql.length : end + 1
        } else if (ch === '/' && sql[i + 1] === '*') {
            i = blockCommentEnd(sql, i)
        } else {
            break
        }
    }
    return (/^[A-Za-z_]+/.exec(sql.slice(i))?.[0] ?? '').toLowerCase()
}

/** The Data API names parameters; these are the names the rewritten SQL refers to. */
const parameterName = (index: number): string => `kp${index}`

/** `CAST(:kpN AS <type>)` — or the bare name when Postgres could not say (`unknown`). */
export function castPlaceholder(index: number, type: string | undefined): string {
    const name = `:${parameterName(index)}`
    return type && type !== 'unknown' ? `CAST(${name} AS ${type})` : name
}

// ---------------------------------------------------------------------------------------------
// What the Data API cannot do
// ---------------------------------------------------------------------------------------------

/** Statements that open, end or abandon a transaction by SQL instead of through the Data API's calls. */
const TRANSACTION_CONTROL = new Set(['begin', 'start', 'commit', 'end', 'abort', 'rollback'])

/** Statements whose only effect is session state, which AWS resets (`DISCARD ALL`) between calls. */
const SESSION_STATE = new Set(['set', 'reset', 'prepare', 'deallocate', 'discard', 'listen', 'unlisten', 'load'])

/**
 * Why `sql` cannot run as written through the Data API, or `null` if it can. Checked before every call,
 * so the failure names the cause instead of the statement silently doing nothing:
 *
 * - transaction control in SQL (`BEGIN`, `COMMIT`, …) bypasses BeginTransaction/CommitTransaction, and
 *   outside a transaction would be committed by the call that sent it. `ROLLBACK TO` (a savepoint) is
 *   fine inside a transaction.
 * - outside a transaction, a statement that only changes session state (`SET`, `SET ROLE`, `PREPARE`,
 *   a temporary table, `set_config(…, false)`) is lost before the next call, because the Data API
 *   resets the connection with `DISCARD ALL` whenever it reuses it. `SET LOCAL` would be a no-op.
 *
 * A heuristic over the leading keyword, not a parser: it exists to fail loudly on the mistakes someone
 * would actually make, and it does not claim to catch an alias.
 */
export function unsupportedStatement(sql: string, inTransaction: boolean): string | null {
    const keyword = leadingKeyword(sql)
    if (TRANSACTION_CONTROL.has(keyword)) {
        const savepoint = keyword === 'rollback' && /^\s*rollback\s+to\b/i.test(sql.replace(/^[\s(]+/, ''))
        if (!(inTransaction && savepoint)) {
            return `\`${keyword.toUpperCase()}\` in SQL bypasses the Data API's transactions — use db.transaction() or withTenant()`
        }
    }
    if (!inTransaction) {
        if (SESSION_STATE.has(keyword)) {
            return `\`${keyword.toUpperCase()}\` outside a transaction is lost before the next Data API call (the connection is reset with DISCARD ALL) — run it inside db.transaction() or withTenant()`
        }
        if (keyword === 'create' && /^\s*create\s+(?:global\s+|local\s+)?temp(?:orary)?\b/i.test(sql)) {
            return 'a temporary table outside a transaction is dropped before the next Data API call — create and use it inside one transaction'
        }
        if (/set_config\s*\([^)]*,\s*false\s*\)/i.test(sql)) {
            return '`set_config(…, false)` outside a transaction is lost before the next Data API call — use set_config(…, true) inside a transaction'
        }
    }
    return null
}

// ---------------------------------------------------------------------------------------------
// Values in
// ---------------------------------------------------------------------------------------------

/**
 * One parameter, as a string the server parses with the type's own input function (the explicit CAST
 * in the SQL), or as a NULL. Mirrors what node-postgres sends for the same JS value, so a value means
 * the same thing on both drivers: a `Date` is its ISO instant, a plain object is JSON, an array is a
 * Postgres array literal, a byte array is `\x` hex.
 */
export function toSqlParameter(index: number, value: unknown): SqlParameter {
    const name = parameterName(index)
    if (value === null || value === undefined) return { name, value: { isNull: true } }
    return { name, value: { stringValue: serializeValue(value) } }
}

function serializeValue(value: unknown): string {
    if (Array.isArray(value)) return arrayLiteral(value)
    return serializeScalar(value)
}

function serializeScalar(value: unknown): string {
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'bigint') return String(value)
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) throw new TypeError('cannot send an invalid Date to the database')
        return value.toISOString()
    }
    if (value instanceof Uint8Array) return `\\x${Buffer.from(value).toString('hex')}`
    return JSON.stringify(value)
}

function arrayLiteral(values: readonly unknown[]): string {
    const items = values.map((item) => {
        if (item === null || item === undefined) return 'NULL'
        if (Array.isArray(item)) return arrayLiteral(item)
        return `"${serializeScalar(item).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    })
    return `{${items.join(',')}}`
}

// ---------------------------------------------------------------------------------------------
// Values out
// ---------------------------------------------------------------------------------------------

/**
 * One result row, keyed by column label, each value decoded to what node-postgres would have returned
 * through keel's pg adapter (../real/db.ts): `int8`/`numeric` as strings, `json`/`jsonb` parsed,
 * `timestamptz` as a `Date`, `date` as the wire string, `bytea` as a Buffer, arrays element by element.
 */
export function decodeRow(record: readonly Field[], columns: readonly ColumnMetadata[]): Record<string, unknown> {
    const row: Record<string, unknown> = {}
    columns.forEach((column, i) => {
        row[column.label || column.name || `?column?`] = decodeField(record[i], column.typeName ?? '')
    })
    return row
}

export function decodeField(field: Field | undefined, typeName: string): unknown {
    if (!field || field.isNull) return null
    const type = typeName.toLowerCase().replace(/^"|"$/g, '')
    if (field.arrayValue !== undefined) return decodeArray(field.arrayValue, type.replace(/^_/, ''))
    const raw = field.stringValue ?? field.longValue ?? field.doubleValue ?? field.booleanValue ?? field.blobValue
    return decodeScalar(raw, type)
}

function decodeArray(value: ArrayValue, baseType: string): unknown[] {
    if (value.arrayValues) return value.arrayValues.map((inner) => (inner ? decodeArray(inner, baseType) : null))
    const items: readonly unknown[] =
        value.stringValues ?? value.longValues ?? value.doubleValues ?? value.booleanValues ?? []
    return items.map((item) => (item === null || item === undefined ? null : decodeScalar(item, baseType)))
}

function decodeScalar(raw: unknown, type: string): unknown {
    if (raw === undefined || raw === null) return null
    switch (type) {
        case 'int2':
        case 'int4':
        case 'oid':
        case 'float4':
        case 'float8':
            return Number(raw)
        case 'int8':
        case 'numeric':
        case 'money':
            return String(raw)
        case 'bool':
            return typeof raw === 'boolean' ? raw : raw === 't' || raw === 'true'
        case 'json':
        case 'jsonb':
            return JSON.parse(String(raw))
        case 'timestamptz':
            return parseTimestamp(String(raw), true)
        case 'timestamp':
            return parseTimestamp(String(raw), false)
        case 'bytea':
            return raw instanceof Uint8Array ? Buffer.from(raw) : Buffer.from(String(raw).replace(/^\\x/, ''), 'hex')
        default:
            return raw
    }
}

const TIMESTAMP = /^(\d{4,})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)(?:\.(\d+))?(Z|[+-]\d\d(?::?\d\d)?)?$/

/**
 * The Data API returns `timestamptz` as a UTC wall-clock string (`2026-11-16 23:00:00.123456`), and
 * node-postgres returns a `Date`; this makes the first into the second. A `timestamp` without a zone is
 * read as local time, as node-postgres does. Sub-millisecond digits are truncated, as a `Date` holds no
 * more. Anything else (`infinity`) comes back as the string.
 */
function parseTimestamp(value: string, utc: boolean): Date | string {
    const m = TIMESTAMP.exec(value)
    if (!m) return value
    const [, y, mo, d, h, mi, s, frac, zone] = m
    const ms = Number((frac ?? '').padEnd(3, '0').slice(0, 3))
    const parts = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms] as const
    if (zone && zone !== 'Z') {
        const sign = zone.startsWith('-') ? -1 : 1
        const [zh, zm] = zone
            .slice(1)
            .replace(':', '')
            .match(/^(\d\d)(\d\d)?$/)!
            .slice(1)
        const offsetMinutes = sign * (Number(zh) * 60 + Number(zm ?? 0))
        return new Date(Date.UTC(...parts) - offsetMinutes * 60_000)
    }
    return utc || zone === 'Z' ? new Date(Date.UTC(...parts)) : new Date(...parts)
}

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

/**
 * A database error from the Data API, carrying what keel's code reads from a node-postgres error:
 * `code` (the SQLSTATE) and, where Postgres names one, `constraint`. The Data API returns only a
 * message, sometimes ending `; SQLState: 23505` and sometimes not, so the SQLSTATE is taken from the
 * message when present and otherwise derived from Postgres's own wording for the errors code acts on.
 * The original error is the `cause`.
 */
export class RdsDataDatabaseError extends Error {
    readonly code: string | undefined
    readonly constraint: string | undefined

    constructor(message: string, code: string | undefined, constraint: string | undefined, cause: unknown) {
        super(message, { cause })
        this.name = 'RdsDataDatabaseError'
        this.code = code
        this.constraint = constraint
    }
}

/** Raised before a call is made, for something the Data API cannot do (see unsupportedStatement). */
export class RdsDataUnsupportedError extends Error {
    constructor(message: string) {
        super(`RDS Data API: ${message}`)
        this.name = 'RdsDataUnsupportedError'
    }
}

const MESSAGE_CODES: readonly [RegExp, string][] = [
    [/duplicate key value violates unique constraint "([^"]+)"/, '23505'],
    [/violates foreign key constraint "([^"]+)"/, '23503'],
    [/violates check constraint "([^"]+)"/, '23514'],
    [/violates exclusion constraint "([^"]+)"/, '23P01'],
    [/violates not-null constraint/, '23502'],
    [/new row violates row-level security policy/, '42501'],
    [/permission denied for/, '42501'],
    [/could not serialize access/, '40001'],
    [/deadlock detected/, '40P01'],
    [/relation "[^"]+" does not exist/, '42P01'],
]

const DATABASE_ERROR_NAMES = new Set(['DatabaseErrorException', 'BadRequestException'])

export function normalizeDatabaseError(error: unknown): unknown {
    if (!(error instanceof Error) || !DATABASE_ERROR_NAMES.has(error.name)) return error
    const message = error.message
    const stated = /SQLState:\s*([0-9A-Z]{5})/.exec(message)?.[1]
    let code = stated
    let constraint: string | undefined
    for (const [pattern, patternCode] of MESSAGE_CODES) {
        const match = pattern.exec(message)
        if (!match) continue
        code ??= patternCode
        constraint = match[1]
        break
    }
    return new RdsDataDatabaseError(message, code, constraint, error)
}
