import { describe, expect, it } from 'vitest'
import {
    castPlaceholder,
    decodeField,
    describableSql,
    leadingKeyword,
    normalizeDatabaseError,
    RdsDataDatabaseError,
    rewritePlaceholders,
    toSqlParameter,
    unsupportedStatement,
} from './rds-data-codec'

/**
 * The pure rules of the RDS Data API dialect. The contract suite (./rds-data.contract.test.ts) proves
 * them composed against real Postgres; these pin the edges that suite would only meet by chance.
 */

const mark = (sql: string) => rewritePlaceholders(sql, (n) => `<${n}>`)

describe('rewritePlaceholders: only real `$n` placeholders are rewritten', () => {
    it.each([
        ['select $1, $2', 'select <1>, <2>'],
        ['select $12', 'select <12>'],
        ["select '$1', $1", "select '$1', <1>"],
        ["select 'it''s $1', $1", "select 'it''s $1', <1>"],
        ["select E'\\' $1', $1", "select E'\\' $1', <1>"],
        ['select "col$1", $1', 'select "col$1", <1>'],
        ['select a$1 from t where x = $1', 'select a$1 from t where x = <1>'],
        ['select $1 -- and $2\n, $3', 'select <1> -- and $2\n, <3>'],
        ['select /* $1 /* nested $2 */ still */ $3', 'select /* $1 /* nested $2 */ still */ <3>'],
        ['do $$ begin perform $1; end $$', 'do $$ begin perform $1; end $$'],
        ['select $fn$ $1 $fn$, $1', 'select $fn$ $1 $fn$, <1>'],
        ['select $1::uuid', 'select <1>::uuid'],
    ])('%s', (sql, expected) => {
        expect(mark(sql)).toBe(expected)
    })

    it('casts to the type Postgres inferred, or leaves an unknown bare — parenthesized either way', () => {
        expect(castPlaceholder(3, 'timestamp with time zone')).toBe('(CAST(:kp3 AS timestamp with time zone))')
        expect(castPlaceholder(1, 'unknown')).toBe('(:kp1)')
        expect(castPlaceholder(1, undefined)).toBe('(:kp1)')
        // after a colon (an array slice) the parentheses are what stop `:CAST` reading as a parameter name
        expect(rewritePlaceholders('select a[1:$1]', (n) => castPlaceholder(n, 'integer'))).toBe(
            'select a[1:(CAST(:kp1 AS integer))]',
        )
    })

    it('describes an EXPLAIN by its statement, whose parameters are the same', () => {
        expect(describableSql('explain select * from t where id = $1')).toBe('select * from t where id = $1')
        expect(describableSql('EXPLAIN (FORMAT JSON, ANALYZE) select $1')).toBe('select $1')
        expect(describableSql('explain analyze verbose select $1')).toBe('select $1')
        expect(describableSql('select explain from t where x = $1')).toBe('select explain from t where x = $1')
        // a comment before it, the British spelling, and a parenthesised statement rather than options
        expect(describableSql('/* tag */ explain select $1')).toBe('select $1')
        expect(describableSql('-- why\nEXPLAIN ANALYSE select $1')).toBe('select $1')
        expect(describableSql('explain (select * from t where id = $1)')).toBe('(select * from t where id = $1)')
        expect(describableSql('explain (costs off) (with x as (select $1) table x)')).toBe(
            '(with x as (select $1) table x)',
        )
    })
})

describe('leadingKeyword', () => {
    it.each([
        ['  SELECT 1', 'select'],
        ['-- note\n/* block */ (select 1)', 'select'],
        ['with x as (select 1) insert into t select * from x', 'with'],
        ['', ''],
    ])('%j -> %s', (sql, keyword) => {
        expect(leadingKeyword(sql)).toBe(keyword)
    })
})

describe('unsupportedStatement: what the Data API cannot do is refused up front', () => {
    it('refuses session state outside a transaction, where DISCARD ALL would erase it', () => {
        expect(unsupportedStatement('SET ROLE app_user', false)).toMatch(/lost before the next Data API call/)
        expect(unsupportedStatement('set local role app_user', false)).toMatch(/lost/)
        expect(unsupportedStatement('PREPARE p AS select 1', false)).toMatch(/lost/)
        expect(unsupportedStatement('create temporary table t (x int)', false)).toMatch(/temporary table/)
        expect(unsupportedStatement("select set_config('a.b', 'x', false)", false)).toMatch(/set_config/)
        expect(unsupportedStatement('select pg_advisory_lock(42)', false)).toMatch(/advisory lock/)
        expect(unsupportedStatement('select pg_try_advisory_lock_shared(42)', false)).toMatch(/advisory lock/)
        // the transaction-scoped form is fine anywhere: it ends with the call's own transaction
        expect(unsupportedStatement('select pg_advisory_xact_lock(42)', false)).toBeNull()
    })

    it('allows the same inside a transaction, where it lasts until Commit', () => {
        expect(unsupportedStatement('SET LOCAL ROLE app_user', true)).toBeNull()
        expect(unsupportedStatement("select set_config('app.current_tenant', $1, true)", true)).toBeNull()
        expect(unsupportedStatement('create temp table t (x int)', true)).toBeNull()
    })

    it('refuses transaction control in SQL everywhere, except a savepoint rollback inside a transaction', () => {
        for (const sql of ['BEGIN', 'start transaction', 'COMMIT', 'end', 'rollback']) {
            expect(unsupportedStatement(sql, false)).toMatch(/bypasses the Data API's transactions/)
            expect(unsupportedStatement(sql, true)).toMatch(/bypasses/)
        }
        expect(unsupportedStatement('rollback to savepoint "a"', true)).toBeNull()
        expect(unsupportedStatement('release savepoint "a"', true)).toBeNull()
    })

    it('leaves ordinary statements alone', () => {
        expect(unsupportedStatement('select 1', false)).toBeNull()
        expect(unsupportedStatement('insert into t values ($1)', false)).toBeNull()
        expect(unsupportedStatement('create table t (x int)', false)).toBeNull()
    })
})

describe('toSqlParameter: every value goes as a string the explicit CAST parses, or as NULL', () => {
    it.each([
        ['a string', 'x', 'x'],
        ['a number', 42, '42'],
        ['a bigint', 9007199254740993n, '9007199254740993'],
        ['a boolean', false, 'false'],
        ['a Date, as its ISO instant', new Date('2026-11-16T23:04:05.678Z'), '2026-11-16T23:04:05.678Z'],
        ['bytes, as \\x hex', Buffer.from([0, 255]), '\\x00ff'],
        ['an object, as JSON', { a: [1, null] }, '{"a":[1,null]}'],
        [
            'an array, as a Postgres array literal',
            ['a', 'b,c', 'say "hi"', 'back\\slash', null],
            '{"a","b,c","say \\"hi\\"","back\\\\slash",NULL}',
        ],
        [
            'a nested array',
            [
                [1, 2],
                [3, null],
            ],
            '{{"1","2"},{"3",NULL}}',
        ],
    ])('%s', (_label, value, stringValue) => {
        expect(toSqlParameter(2, value)).toEqual({ name: 'kp2', value: { stringValue } })
    })

    it('null and undefined are NULL', () => {
        expect(toSqlParameter(1, null)).toEqual({ name: 'kp1', value: { isNull: true } })
        expect(toSqlParameter(1, undefined)).toEqual({ name: 'kp1', value: { isNull: true } })
    })

    it('an invalid Date is refused rather than sent as "Invalid Date"', () => {
        expect(() => toSqlParameter(1, new Date('nope'))).toThrow(/invalid Date/)
    })
})

describe('decodeField: what node-postgres would have returned through keel’s pg adapter', () => {
    it.each([
        ['int4 from a long', { longValue: 7 }, 'int4', 7],
        ['int4 from a string (longReturnType STRING)', { stringValue: '7' }, 'int4', 7],
        ['int8 stays a string', { stringValue: '9007199254740993' }, 'int8', '9007199254740993'],
        ['numeric stays a string', { stringValue: '1.50' }, 'numeric', '1.50'],
        ['float8', { doubleValue: 1.5 }, 'float8', 1.5],
        ['bool', { booleanValue: true }, 'bool', true],
        ['jsonb is parsed', { stringValue: '{"a":[1]}' }, 'jsonb', { a: [1] }],
        ['date stays the wire string', { stringValue: '2026-10-03' }, 'date', '2026-10-03'],
        ['uuid is a string', { stringValue: 'abc' }, 'uuid', 'abc'],
        ['an unknown type comes through as given', { stringValue: '1 day' }, 'interval', '1 day'],
        ['NULL', { isNull: true }, 'uuid', null],
    ])('%s', (_label, field, typeName, expected) => {
        expect(decodeField(field, typeName)).toEqual(expected)
    })

    it('timestamptz, a UTC wall-clock string, becomes the same instant as a Date (ms precision)', () => {
        expect(decodeField({ stringValue: '2026-11-16 23:04:05.678912' }, 'timestamptz')).toEqual(
            new Date('2026-11-16T23:04:05.678Z'),
        )
        expect(decodeField({ stringValue: '2026-11-16 23:04:05' }, 'timestamptz')).toEqual(
            new Date('2026-11-16T23:04:05Z'),
        )
        expect(decodeField({ stringValue: '2026-11-17 01:04:05+02' }, 'timestamptz')).toEqual(
            new Date('2026-11-16T23:04:05Z'),
        )
        expect(decodeField({ stringValue: 'not a time' }, 'timestamptz')).toBe('not a time')
    })

    it('timestamptz edge cases come back as node-postgres returns them', () => {
        expect(decodeField({ stringValue: 'infinity' }, 'timestamptz')).toBe(Infinity)
        expect(decodeField({ stringValue: '-infinity' }, 'timestamptz')).toBe(-Infinity)
        // a year below 100 is itself, not 19xx (Date.UTC's trap)
        expect((decodeField({ stringValue: '0050-01-01 00:00:00' }, 'timestamptz') as Date).toISOString()).toBe(
            '0050-01-01T00:00:00.000Z',
        )
        // BC is a negative year: 44 BC is astronomical year -43
        expect((decodeField({ stringValue: '0044-03-15 12:00:00 BC' }, 'timestamptz') as Date).getUTCFullYear()).toBe(
            -43,
        )
    })

    it('PgJDBC names auto-increment columns serial/bigserial; they decode as int4/int8 do', () => {
        expect(decodeField({ stringValue: '7' }, 'serial')).toBe(7)
        expect(decodeField({ stringValue: '9007199254740993' }, 'bigserial')).toBe('9007199254740993')
    })

    it('numeric[] elements are numbers, as node-postgres parses them, though a bare numeric stays a string', () => {
        expect(decodeField({ arrayValue: { stringValues: ['1.5', '2.25'] } }, '_numeric')).toEqual([1.5, 2.25])
    })

    it('bytea becomes a Buffer', () => {
        expect(decodeField({ blobValue: new Uint8Array([1, 2]) }, 'bytea')).toEqual(Buffer.from([1, 2]))
    })

    it('arrays decode element by element with the base type, nested and with NULLs', () => {
        expect(
            decodeField({ arrayValue: { stringValues: ['2026-10-03', null as unknown as string] } }, '_date'),
        ).toEqual(['2026-10-03', null])
        expect(
            decodeField(
                { arrayValue: { arrayValues: [{ stringValues: ['1', '2'] }, { stringValues: ['3'] }] } },
                '_int4',
            ),
        ).toEqual([[1, 2], [3]])
    })
})

describe('normalizeDatabaseError: code and constraint where node-postgres would put them', () => {
    const awsError = (name: string, message: string) => Object.assign(new Error(message), { name })

    it('takes the SQLSTATE the message states', () => {
        const error = normalizeDatabaseError(
            awsError('DatabaseErrorException', 'ERROR: database "x" does not exist; SQLState: 3D000'),
        )
        expect(error).toBeInstanceOf(RdsDataDatabaseError)
        expect((error as RdsDataDatabaseError).code).toBe('3D000')
    })

    it('derives it from Postgres’s wording when the message has none', () => {
        const unique = normalizeDatabaseError(
            awsError(
                'DatabaseErrorException',
                'ERROR: duplicate key value violates unique constraint "tickets_tenant_ref_idx"',
            ),
        ) as RdsDataDatabaseError
        expect([unique.code, unique.constraint]).toEqual(['23505', 'tickets_tenant_ref_idx'])

        const rls = normalizeDatabaseError(
            awsError('BadRequestException', 'ERROR: new row violates row-level security policy for table "jobs"'),
        ) as RdsDataDatabaseError
        expect(rls.code).toBe('42501')
        expect(String(rls)).toMatch(/row-level security/)
    })

    it('a stated SQLSTATE wins, and the constraint is still read', () => {
        const error = normalizeDatabaseError(
            awsError(
                'DatabaseErrorException',
                'ERROR: duplicate key value violates unique constraint "k"; SQLState: 23505',
            ),
        ) as RdsDataDatabaseError
        expect([error.code, error.constraint]).toEqual(['23505', 'k'])
    })

    it('passes every other error through untouched', () => {
        const timeout = awsError('StatementTimeoutException', 'timed out')
        expect(normalizeDatabaseError(timeout)).toBe(timeout)
        expect(normalizeDatabaseError('not an error')).toBe('not an error')
    })
})
