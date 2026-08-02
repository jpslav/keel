/**
 * Keyset (cursor) pagination — the PURE, ISOMORPHIC half (ADR-0006, lint-enforced: no framework
 * imports, no node builtins, no DOM globals). The SQL half is `keel/db/keyset`; this file is the
 * cursor's grammar, and it is shared verbatim by the server routes and the `file://` static-demo
 * twin, so a cursor means exactly the same thing in both worlds.
 *
 * WHY KEYSET AND NOT OFFSET. `LIMIT n OFFSET k` over a tenant-scoped table is wrong twice. It is
 * slow — Postgres must walk and discard the first k rows on every page, so the last page of a long
 * queue costs the most. And it is UNSTABLE: rows are inserted at the head of a newest-first list all
 * day, so between page 1 and page 2 everything shifts down by however many arrived, and the reader
 * sees a row twice or never sees it at all. A keyset cursor names a POSITION IN THE ORDERING rather
 * than a count of skipped rows, so inserts above it are simply invisible to the walk.
 *
 * WHAT A CURSOR IS, AND WHAT IT DELIBERATELY IS NOT. A cursor is a position and nothing else: the
 * ordering timestamp plus the primary key that breaks ties on it. It names no tenant, no
 * organization, no table, no user, and no limit — there is nothing in its grammar with which to
 * name a scope. Scope is re-applied from server-side session state on EVERY page (see
 * `keel/db/keyset`, which opens the `withTenant` transaction itself), and the cursor is ANDed on
 * top of it. Because a conjunct can only ever remove rows from a result set, a crafted cursor is
 * structurally incapable of WIDENING one; the worst it can do is return fewer of the caller's own
 * rows.
 *
 * A cursor is OPAQUE (base64url) so that clients treat it as a token rather than as an API they can
 * compute — but opaque is not the same as trusted. It arrives from the client, so `parseKeysetCursor`
 * is TOTAL: every input, however hostile, lands on exactly one of `start` / `after` / `invalid`, and
 * it never throws. Both fields are validated against a strict pattern BEFORE anything downstream may
 * bind them, and the encoding is canonical (padding bits must be zero), so one position has exactly
 * one cursor and a malleated cursor is rejected rather than silently normalised.
 */

/** The ceiling on a page, enforced server-side. A client asking for more gets this. */
export const KEYSET_MAX_LIMIT = 100

/** What a caller gets when it expresses no preference. */
export const KEYSET_DEFAULT_LIMIT = 20

/** The longest cursor we will even look at — a bound before any parsing work happens. */
const CURSOR_MAX_CHARS = 256

/**
 * A position in a keyset ordering: the ordering timestamp, plus the primary key that totally orders
 * rows sharing it. BOTH halves are required — a timestamp alone is not unique, and rows written in
 * one transaction all carry the identical `now()`, so a timestamp-only cursor would either repeat
 * or drop every row in the batch.
 */
export interface KeysetPosition {
    /**
     * The ordering instant, as an ISO-8601 UTC string. Rendered by whoever OWNS the value — the
     * database for a SQL page (`keel/db/keyset` asks Postgres for six fractional digits), the twin's
     * own row for an in-memory one. Never re-derived through a JS `Date` on the way out: `Date` is
     * millisecond-precision and `timestamptz` is microsecond-precision, so a JS round trip truncates
     * the position and the next page silently skips every row inside that millisecond.
     */
    at: string
    /** The primary key tiebreak, as stored. */
    id: string
}

/** ISO-8601 UTC instant with 0–6 fractional digits: `2026-07-31T09:15:04Z` … `…T09:15:04.123456Z`. */
const AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/

/**
 * The id charset. Deliberately narrow and bounded rather than "any string": it admits the uuids real
 * rows carry and the opaque handles an in-memory twin mints, and admits nothing that could be
 * mistaken for SQL, a delimiter, or an unbounded blob. `keel/db/keyset` narrows this further to a
 * uuid before binding, because that is the layer where a non-uuid would become a cast error.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** Neither field's charset contains it, so the split is unambiguous. */
const FIELD_SEPARATOR = '|'

/** What a cursor query-string parameter turned out to be. Total: every input lands on one of these. */
export type KeysetCursorParse =
    | { kind: 'start'; position?: undefined }
    | { kind: 'after'; position: KeysetPosition }
    | { kind: 'invalid'; position?: undefined }

/** True when `position` is one this module is willing to encode or hand onward. */
export function isKeysetPosition(position: KeysetPosition): boolean {
    return AT_PATTERN.test(position.at) && ID_PATTERN.test(position.id)
}

/**
 * Mints the opaque cursor for a position. Throws on a position this module would refuse to parse
 * back — an unrepresentable cursor is a bug in the caller's ordering key, and failing at mint time
 * keeps it from becoming a mysterious `invalid` on the next request instead.
 */
export function encodeKeysetCursor(position: KeysetPosition): string {
    if (!isKeysetPosition(position)) {
        throw new Error(`keyset: cannot encode position (at=${position.at}, id=${position.id})`)
    }
    return base64UrlEncode(`${position.at}${FIELD_SEPARATOR}${position.id}`)
}

/**
 * Decodes a cursor from the wire. TOTAL — never throws, for any input. Absent (null/undefined/empty)
 * means "first page"; anything that is not a canonical encoding of a well-formed position is
 * `invalid`, which callers should surface as a 400 rather than silently treat as the first page: a
 * cursor the server cannot read is a client bug worth hearing about. Note that even a caller which
 * ignored that advice and paged from the start would be safe — the scope comes from the session, not
 * from the cursor, so the failure mode is a repeated first page, never a widened one.
 */
export function parseKeysetCursor(raw: string | null | undefined): KeysetCursorParse {
    if (raw === null || raw === undefined || raw === '') return { kind: 'start' }
    if (raw.length > CURSOR_MAX_CHARS) return { kind: 'invalid' }
    const decoded = base64UrlDecode(raw)
    if (decoded === null) return { kind: 'invalid' }
    const parts = decoded.split(FIELD_SEPARATOR)
    if (parts.length !== 2) return { kind: 'invalid' }
    const [at, id] = parts
    if (at === undefined || id === undefined) return { kind: 'invalid' }
    if (!AT_PATTERN.test(at) || !ID_PATTERN.test(id)) return { kind: 'invalid' }
    // The pattern admits 2026-02-31, and JS SILENTLY ROLLS THAT OVER to 2026-03-03 rather than
    // reporting NaN — so the calendar check is a round trip, not a parse: a timestamp that does not
    // survive being re-rendered is not a timestamp the database ever wrote.
    const parsed = new Date(at)
    if (Number.isNaN(parsed.getTime())) return { kind: 'invalid' }
    if (parsed.toISOString().slice(0, 19) !== at.slice(0, 19)) return { kind: 'invalid' }
    return { kind: 'after', position: { at, id } }
}

/**
 * The page size, decided by the SERVER. A client may ask (`?limit=`), and is answered with something
 * between 1 and KEYSET_MAX_LIMIT — never with what it asked for. Anything unparseable falls back to
 * `fallback`, which is itself clamped, so no call site can widen the cap by passing a large default.
 */
export function clampKeysetLimit(
    raw: string | number | null | undefined,
    fallback: number = KEYSET_DEFAULT_LIMIT,
): number {
    if (typeof raw === 'number') return clamp(raw)
    if (typeof raw === 'string' && /^\d{1,9}$/.test(raw)) return clamp(Number.parseInt(raw, 10))
    return clamp(fallback)
}

function clamp(value: number): number {
    if (!Number.isFinite(value)) return KEYSET_DEFAULT_LIMIT
    const whole = Math.floor(value)
    if (whole < 1) return 1
    if (whole > KEYSET_MAX_LIMIT) return KEYSET_MAX_LIMIT
    return whole
}

/**
 * The IN-MEMORY pager: the same cursor semantics as the SQL one, over an array. This is what a
 * static-demo twin (or any fake adapter) pages with, so the `file://` build walks a real cursor chain
 * rather than faking a "load more" that just slices — the twin encodes and re-parses the identical
 * token the server would.
 *
 * `position` must render every row's `at` the same way (one source of truth per list), because the
 * comparison is the string-lexicographic twin of SQL's row-value comparison `(at, id) < (…)`.
 */
export function keysetPageInMemory<T>(
    rows: readonly T[],
    position: (row: T) => KeysetPosition,
    request: { after: KeysetPosition | null; limit: number },
): { rows: T[]; nextCursor: string | null } {
    const limit = clamp(request.limit)
    const ordered = [...rows].sort((a, b) => comparePositions(position(b), position(a)))
    const after = request.after
    const windowed = after ? ordered.filter((row) => comparePositions(position(row), after) < 0) : ordered
    const page = windowed.slice(0, limit)
    const last = page.at(-1)
    return {
        rows: page,
        nextCursor: windowed.length > limit && last ? encodeKeysetCursor(position(last)) : null,
    }
}

/** Ascending tuple order on (at, id) — the JS twin of Postgres's row-value comparison. */
function comparePositions(a: KeysetPosition, b: KeysetPosition): number {
    if (a.at !== b.at) return a.at < b.at ? -1 : 1
    if (a.id !== b.id) return a.id < b.id ? -1 : 1
    return 0
}

// ---- base64url, hand-rolled ----
//
// Hand-rolled for the same reason webhook-signing.ts hand-rolls SHA-256: this module must run
// unchanged on the server AND inside a `file://` bundle, so it may not reach for a node builtin, and
// `btoa`/`atob` are latin1-oriented globals whose availability is an environment assumption rather
// than a property of the code. The payload is ASCII BY CONSTRUCTION — both fields are pattern-checked
// before encoding — so this is a plain byte↔char mapping with no UTF-8 machinery, and a decoded byte
// above 0x7f is treated as a malformed cursor rather than mojibake. Unpadded, URL-safe, canonical.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

function base64UrlEncode(ascii: string): string {
    let out = ''
    for (let i = 0; i < ascii.length; i += 3) {
        const b0 = ascii.charCodeAt(i)
        const has1 = i + 1 < ascii.length
        const has2 = i + 2 < ascii.length
        const b1 = has1 ? ascii.charCodeAt(i + 1) : 0
        const b2 = has2 ? ascii.charCodeAt(i + 2) : 0
        out += ALPHABET[b0 >> 2]
        out += ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)]
        if (has1) out += ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)]
        if (has2) out += ALPHABET[b2 & 0x3f]
    }
    return out
}

function base64UrlDecode(text: string): string | null {
    let accumulator = 0
    let bits = 0
    let out = ''
    for (const character of text) {
        const value = ALPHABET.indexOf(character)
        if (value < 0) return null
        accumulator = (accumulator << 6) | value
        bits += 6
        if (bits >= 8) {
            bits -= 8
            const byte = (accumulator >> bits) & 0xff
            if (byte > 0x7f) return null
            out += String.fromCharCode(byte)
            accumulator &= (1 << bits) - 1
        }
    }
    // A 6-bit remainder means a dangling character (length % 4 === 1); a NON-ZERO remainder means the
    // encoder left data in the padding bits. Both are rejected, which is what makes the encoding
    // canonical: exactly one cursor string decodes to any given position.
    if (bits >= 6 || accumulator !== 0) return null
    return out
}
