import { describe, expect, it } from 'vitest'
import {
    KEYSET_DEFAULT_LIMIT,
    KEYSET_MAX_LIMIT,
    type KeysetPosition,
    clampKeysetLimit,
    encodeKeysetCursor,
    isKeysetPosition,
    keysetPageInMemory,
    parseKeysetCursor,
} from './keyset'

const POSITION: KeysetPosition = { at: '2026-07-31T09:15:04.123456Z', id: '0f8fad5b-d9cb-469f-a165-70867728950e' }

describe('cursor round trip', () => {
    it('decodes back to the position it was minted from', () => {
        const parsed = parseKeysetCursor(encodeKeysetCursor(POSITION))
        expect(parsed.kind).toBe('after')
        expect(parsed.position).toEqual(POSITION)
    })

    it('is opaque — the position is not readable off the wire', () => {
        const cursor = encodeKeysetCursor(POSITION)
        expect(cursor).not.toContain('2026')
        expect(cursor).not.toContain(POSITION.id)
    })

    it('is URL-safe, so it survives a query string unescaped', () => {
        const cursor = encodeKeysetCursor(POSITION)
        expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/)
        expect(encodeURIComponent(cursor)).toBe(cursor)
    })

    it('agrees with a standard base64url encoder', () => {
        const expected = Buffer.from(`${POSITION.at}|${POSITION.id}`, 'ascii').toString('base64url')
        expect(encodeKeysetCursor(POSITION)).toBe(expected)
    })

    it('round-trips positions of every payload length modulo 3 (the base64 block boundary)', () => {
        for (const suffix of ['a', 'ab', 'abc', 'abcd', 'abcde']) {
            const position = { at: '2026-07-31T09:15:04Z', id: `id-${suffix}` }
            expect(parseKeysetCursor(encodeKeysetCursor(position)).position).toEqual(position)
        }
    })

    it('refuses to mint a cursor from a position it could not parse back', () => {
        expect(() => encodeKeysetCursor({ at: 'yesterday', id: POSITION.id })).toThrow()
        expect(() => encodeKeysetCursor({ at: POSITION.at, id: 'has spaces' })).toThrow()
        expect(isKeysetPosition({ at: 'yesterday', id: POSITION.id })).toBe(false)
    })

    it('accepts a timestamp at any precision the renderer chose (ms twin, µs server)', () => {
        for (const at of ['2026-07-31T09:15:04Z', '2026-07-31T09:15:04.123Z', '2026-07-31T09:15:04.123456Z']) {
            expect(parseKeysetCursor(encodeKeysetCursor({ at, id: 'seed-ticket-3' })).kind).toBe('after')
        }
    })
})

describe('parseKeysetCursor is total and fails closed', () => {
    it('treats an absent cursor as the first page', () => {
        expect(parseKeysetCursor(null).kind).toBe('start')
        expect(parseKeysetCursor(undefined).kind).toBe('start')
        expect(parseKeysetCursor('').kind).toBe('start')
    })

    // The security-relevant table: every one of these arrives from a client, and every one must land
    // on `invalid` — never throw, and never yield a position something downstream would bind.
    const hostile: Array<[string, string]> = [
        ['not base64 at all', 'hello world'],
        ['base64url charset violated', 'YWJj+/=='],
        ['padded (non-canonical)', 'YWJjZA=='],
        ['dangling character (length % 4 === 1)', 'YWJjZA' + 'A'],
        ['non-zero padding bits (malleated)', 'YWJjZB'],
        ['decodes to a non-ASCII byte', Buffer.from([0xff, 0x7c, 0x61]).toString('base64url')],
        ['no separator', Buffer.from('2026-07-31T09:15:04Z', 'ascii').toString('base64url')],
        ['two separators', Buffer.from('2026-07-31T09:15:04Z|a|b', 'ascii').toString('base64url')],
        ['empty payload halves', Buffer.from('|', 'ascii').toString('base64url')],
        [
            'timestamp is prose',
            Buffer.from('yesterday|0f8fad5b-d9cb-469f-a165-70867728950e', 'ascii').toString('base64url'),
        ],
        [
            'timestamp is a real date that does not exist',
            Buffer.from('2026-02-31T09:15:04Z|0f8fad5b-d9cb-469f-a165-70867728950e', 'ascii').toString('base64url'),
        ],
        [
            'timestamp carries an offset instead of Z',
            Buffer.from('2026-07-31T09:15:04+05:00|0f8fad5b-d9cb-469f-a165-70867728950e', 'ascii').toString(
                'base64url',
            ),
        ],
        [
            'timestamp over-precise (nanoseconds)',
            Buffer.from('2026-07-31T09:15:04.123456789Z|0f8fad5b-d9cb-469f-a165-70867728950e', 'ascii').toString(
                'base64url',
            ),
        ],
        ['id carries SQL', Buffer.from("2026-07-31T09:15:04Z|' OR 1=1 --", 'ascii').toString('base64url')],
        ['id carries a NUL', Buffer.from('2026-07-31T09:15:04Z|a\x00b', 'ascii').toString('base64url')],
        ['id is empty', Buffer.from('2026-07-31T09:15:04Z|', 'ascii').toString('base64url')],
        ['id is unbounded', Buffer.from(`2026-07-31T09:15:04Z|${'a'.repeat(65)}`, 'ascii').toString('base64url')],
    ]

    it.each(hostile)('rejects %s', (_label, raw) => {
        expect(parseKeysetCursor(raw)).toEqual({ kind: 'invalid' })
    })

    it('rejects an over-long cursor before doing any parsing work', () => {
        expect(parseKeysetCursor('A'.repeat(100_000))).toEqual({ kind: 'invalid' })
    })

    it('never throws, for any byte sequence a client can send', () => {
        // Exhaustive over single characters, plus a fuzz sweep — the property under test is totality,
        // so what matters is that NOTHING escapes as an exception.
        for (let code = 0; code < 0x2100; code++) {
            expect(() => parseKeysetCursor(String.fromCharCode(code))).not.toThrow()
        }
        let seed = 12345
        const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648)
        for (let i = 0; i < 2_000; i++) {
            const length = next() % 40
            let raw = ''
            for (let c = 0; c < length; c++) raw += String.fromCharCode(next() % 0x2100)
            const parsed = parseKeysetCursor(raw)
            expect(['start', 'after', 'invalid']).toContain(parsed.kind)
            // Anything that DID parse must be a position the encoder would have produced — the fuzz
            // may not conjure an `after` this module would refuse to re-encode.
            if (parsed.kind === 'after') expect(isKeysetPosition(parsed.position)).toBe(true)
        }
    })
})

describe('clampKeysetLimit', () => {
    it('caps whatever the query string asked for', () => {
        expect(clampKeysetLimit('1000000')).toBe(KEYSET_MAX_LIMIT)
        expect(clampKeysetLimit(Number.MAX_SAFE_INTEGER)).toBe(KEYSET_MAX_LIMIT)
        expect(clampKeysetLimit(KEYSET_MAX_LIMIT + 1)).toBe(KEYSET_MAX_LIMIT)
    })

    it('floors at one row, so a page is never empty by request', () => {
        expect(clampKeysetLimit('0')).toBe(1)
        expect(clampKeysetLimit(-50)).toBe(1)
    })

    it('falls back when the parameter is absent or not a number', () => {
        expect(clampKeysetLimit(null)).toBe(KEYSET_DEFAULT_LIMIT)
        expect(clampKeysetLimit(undefined)).toBe(KEYSET_DEFAULT_LIMIT)
        expect(clampKeysetLimit('')).toBe(KEYSET_DEFAULT_LIMIT)
        expect(clampKeysetLimit('20; DROP TABLE tickets')).toBe(KEYSET_DEFAULT_LIMIT)
        expect(clampKeysetLimit('1e9')).toBe(KEYSET_DEFAULT_LIMIT)
        expect(clampKeysetLimit(Number.NaN)).toBe(KEYSET_DEFAULT_LIMIT)
    })

    it('clamps the fallback too, so no call site can widen the cap by passing a big default', () => {
        expect(clampKeysetLimit(null, 5_000)).toBe(KEYSET_MAX_LIMIT)
        expect(clampKeysetLimit(null, 5)).toBe(5)
    })

    it('honours a request inside the cap', () => {
        expect(clampKeysetLimit('7')).toBe(7)
    })
})

describe('keysetPageInMemory (the static-demo twin of the SQL pager)', () => {
    interface Row {
        id: string
        at: string
    }
    const positionOf = (row: Row): KeysetPosition => ({ at: row.at, id: row.id })

    // Deliberately includes a batch that shares ONE timestamp — the case a timestamp-only cursor
    // cannot express, and the case the seeded world actually produces (one transaction, one now()).
    const rows: Row[] = [
        { id: 'r9', at: '2026-07-31T09:00:00.000Z' },
        { id: 'r8', at: '2026-07-30T09:00:00.000Z' },
        { id: 'r7', at: '2026-07-29T09:00:00.000Z' },
        { id: 'r6', at: '2026-07-28T09:00:00.000Z' },
        { id: 'r5', at: '2026-07-28T09:00:00.000Z' },
        { id: 'r4', at: '2026-07-28T09:00:00.000Z' },
        { id: 'r3', at: '2026-07-27T09:00:00.000Z' },
    ]

    /** Walk every page the way a "load more" button does, and report what the reader ended up with. */
    function walk(limit: number): string[] {
        const seen: string[] = []
        let cursor: string | null = null
        for (let guard = 0; guard < 50; guard++) {
            const parsed = parseKeysetCursor(cursor)
            expect(parsed.kind).not.toBe('invalid')
            const page: { rows: Row[]; nextCursor: string | null } = keysetPageInMemory(rows, positionOf, {
                after: parsed.kind === 'after' ? parsed.position : null,
                limit,
            })
            seen.push(...page.rows.map((row) => row.id))
            if (page.nextCursor === null) return seen
            cursor = page.nextCursor
        }
        throw new Error('walk did not terminate')
    }

    it('returns rows newest-first, tiebroken on id descending', () => {
        expect(walk(50)).toEqual(['r9', 'r8', 'r7', 'r6', 'r5', 'r4', 'r3'])
    })

    it('walks the whole list exactly once — no duplicates, no drops — at every page size', () => {
        for (let limit = 1; limit <= 8; limit++) {
            const seen = walk(limit)
            expect(seen).toEqual(['r9', 'r8', 'r7', 'r6', 'r5', 'r4', 'r3'])
            expect(new Set(seen).size).toBe(rows.length)
        }
    })

    it('does not stall inside a batch that shares one timestamp', () => {
        // Page 1 ends mid-batch (r6); page 2 must continue with r5, not re-serve the batch or skip it.
        const first = keysetPageInMemory(rows, positionOf, { after: null, limit: 4 })
        expect(first.rows.map((row) => row.id)).toEqual(['r9', 'r8', 'r7', 'r6'])
        const cursor = parseKeysetCursor(first.nextCursor)
        expect(cursor.kind).toBe('after')
        const second = keysetPageInMemory(rows, positionOf, { after: cursor.position ?? null, limit: 4 })
        expect(second.rows.map((row) => row.id)).toEqual(['r5', 'r4', 'r3'])
        expect(second.nextCursor).toBeNull()
    })

    it('is stable under inserts at the head — the classic OFFSET bug', () => {
        const first = keysetPageInMemory(rows, positionOf, { after: null, limit: 3 })
        // Two rows arrive above the window between the two reads, as they do in a live queue.
        const grown = [
            { id: 'rB', at: '2026-08-01T09:00:00.000Z' },
            { id: 'rA', at: '2026-08-01T08:00:00.000Z' },
            ...rows,
        ]
        const cursor = parseKeysetCursor(first.nextCursor)
        const second = keysetPageInMemory(grown, positionOf, { after: cursor.position ?? null, limit: 3 })
        // OFFSET 3 would have re-served r7 and r6 here. The cursor simply does not see the new rows.
        expect(second.rows.map((row) => row.id)).toEqual(['r6', 'r5', 'r4'])
    })

    it('reports no next cursor when the page exactly exhausts the list', () => {
        expect(keysetPageInMemory(rows, positionOf, { after: null, limit: rows.length }).nextCursor).toBeNull()
    })

    it('caps its own limit, like the SQL pager', () => {
        const many = Array.from({ length: 200 }, (_, index) => ({
            id: `x${String(index).padStart(3, '0')}`,
            at: '2026-07-31T09:00:00.000Z',
        }))
        expect(keysetPageInMemory(many, positionOf, { after: null, limit: 1_000 }).rows).toHaveLength(KEYSET_MAX_LIMIT)
    })

    it('returns nothing (never everything) for a position past the end of the list', () => {
        const past = { at: '1999-01-01T00:00:00.000Z', id: 'aaa' }
        expect(keysetPageInMemory(rows, positionOf, { after: past, limit: 10 }).rows).toEqual([])
    })
})
