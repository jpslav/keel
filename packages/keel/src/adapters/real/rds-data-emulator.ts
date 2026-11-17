import { randomUUID } from 'node:crypto'
import {
    BeginTransactionCommand,
    CommitTransactionCommand,
    ExecuteStatementCommand,
    RollbackTransactionCommand,
    type ArrayValue,
    type ColumnMetadata,
    type ExecuteStatementCommandOutput,
    type Field,
    type SqlParameter,
} from '@aws-sdk/client-rds-data'
import { Pool, type PoolClient } from 'pg'
import { isMultistatement, sqlSegments } from './rds-data-codec'
import type { RdsDataClientLike, RdsDataCommand } from './rds-data-dialect'

/**
 * TEST ONLY: the RDS Data API's documented behaviour, emulated over a real Postgres so the contract
 * suite can run keel's proofs THROUGH the Data API dialect (./rds-data.contract.test.ts) without AWS,
 * docker or credentials. Nothing in an app or a deployment imports it.
 *
 * It is deliberately STRICT where AWS is strict, because a lenient emulator proves nothing (the popular
 * community emulator types untyped strings as `unknown`, so code that fails on real Aurora passes on it):
 *
 * - an untyped `stringValue` is bound as `varchar`, so `uuid = :p` without a cast or a UUID typeHint
 *   fails here exactly as it does on Aurora; typeHints bind as their documented types;
 * - an `arrayValue` parameter is refused ("Array parameters are not supported");
 * - every connection is reset with `DISCARD ALL` before it is reused, so session state never survives
 *   between calls outside a transaction (AWS: "Session management with Amazon RDS Data API");
 * - a statement inside a transaction runs on that transaction's one connection, until Commit/Rollback;
 * - a response over 1 MiB is refused, and an unknown transaction id is TransactionNotFoundException;
 * - database errors come back as a message only, WITHOUT a SQLSTATE — the least the Data API is
 *   reported to give, so what is proven is that keel's error handling survives the worst case.
 *
 * What it cannot know is AWS's exact wire format (column `typeName`s, timestamp strings, error wording).
 * It follows PgJDBC's conventions, which the Data API is built on; the `data-api` cutover row is the live
 * check of the same contract.
 */
export interface EmulatedCall {
    operation: 'BeginTransaction' | 'ExecuteStatement' | 'CommitTransaction' | 'RollbackTransaction'
    transactionId: string | undefined
    sql?: string
}

const RESPONSE_LIMIT_BYTES = 1024 * 1024

export class RdsDataEmulator implements RdsDataClientLike {
    /** Every call, in order — the contract suite asserts on the transaction sequence. */
    readonly calls: EmulatedCall[] = []

    readonly #pool: Pool
    readonly #database: string
    readonly #transactions = new Map<string, PoolClient>()
    readonly #reset: boolean
    #typeNames: Map<number, string> | undefined

    /**
     * `resetConnections: false` and `maxConnections: 1` are for ONE kind of test only: proving that state
     * is transaction-local in its own right, which the documented reset would otherwise hide by wiping it
     * anyway. They make the emulator less like AWS, never more lenient about what reaches the database.
     */
    constructor(connectionString: string, options: { resetConnections?: boolean; maxConnections?: number } = {}) {
        this.#database = decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ''))
        this.#reset = options.resetConnections ?? true
        this.#pool = new Pool({
            connectionString,
            max: options.maxConnections ?? 8,
            // The Data API returns timestamptz in UTC; a UTC session makes Postgres print it that way.
            options: '-c TimeZone=UTC',
            // Raw text for every type: the emulator does its own typing, as the Data API does.
            types: { getTypeParser: () => (value: string) => value },
        })
    }

    async send(command: RdsDataCommand): Promise<unknown> {
        if (command instanceof BeginTransactionCommand) {
            this.#checkDatabase(command.input.database)
            const client = await this.#pool.connect()
            await client.query('BEGIN')
            const transactionId = randomUUID()
            this.#transactions.set(transactionId, client)
            this.calls.push({ operation: 'BeginTransaction', transactionId })
            return { transactionId }
        }
        if (command instanceof CommitTransactionCommand || command instanceof RollbackTransactionCommand) {
            const commit = command instanceof CommitTransactionCommand
            const transactionId = command.input.transactionId!
            const client = this.#transactions.get(transactionId)
            this.calls.push({ operation: commit ? 'CommitTransaction' : 'RollbackTransaction', transactionId })
            if (!client) throw awsError('TransactionNotFoundException', `Transaction ${transactionId} is not found`)
            this.#transactions.delete(transactionId)
            let ended
            try {
                ended = await client.query(commit ? 'COMMIT' : 'ROLLBACK')
            } catch (error) {
                // A commit can fail (a deferred constraint); it comes back like any statement's error.
                throw awsError('DatabaseErrorException', `ERROR: ${(error as Error).message}`, error)
            } finally {
                await this.#release(client)
            }
            // Postgres answers COMMIT on an aborted transaction with ROLLBACK; report what actually happened.
            return {
                transactionStatus: commit && ended.command === 'COMMIT' ? 'Transaction Committed' : 'Rollback Complete',
            }
        }
        if (command instanceof ExecuteStatementCommand) return this.#execute(command)
        throw new Error('the emulator handles BeginTransaction, ExecuteStatement, Commit and Rollback only')
    }

    /** Rolls back anything still open and closes the pool. */
    async close(): Promise<void> {
        for (const client of this.#transactions.values()) {
            await client.query('ROLLBACK').catch(() => undefined)
            client.release()
        }
        this.#transactions.clear()
        await this.#pool.end()
    }

    async #execute(command: ExecuteStatementCommand): Promise<ExecuteStatementCommandOutput> {
        const input = command.input
        this.#checkDatabase(input.database)
        const sql = input.sql ?? ''
        this.calls.push({ operation: 'ExecuteStatement', transactionId: input.transactionId, sql })
        if (sql.length > 65536) throw awsError('ValidationException', 'sql must be at most 65536 characters')
        // Refused before anything runs. The name and wording are this emulator's; step 4 of
        // docs/runbooks/data-api.md records what AWS sends.
        if (isMultistatement(sql)) throw awsError('ValidationException', "Multistatements aren't supported.")
        if (input.formatRecordsAs === 'JSON') throw new Error('the emulator does not implement formatRecordsAs JSON')
        const parameters = input.parameters ?? []
        if (parameters.some((p) => p.value?.arrayValue !== undefined)) {
            throw awsError('ValidationException', 'Array parameters are not supported')
        }
        const { text, values } = toPositional(sql, parameters)

        const inTransaction = input.transactionId !== undefined
        let client: PoolClient
        if (inTransaction) {
            const found = this.#transactions.get(input.transactionId!)
            if (!found)
                throw awsError('TransactionNotFoundException', `Transaction ${input.transactionId} is not found`)
            client = found
        } else {
            client = await this.#pool.connect()
        }

        try {
            const typeNames = await this.#types(client)
            let result
            try {
                result = await client.query({ text, values, rowMode: 'array' })
            } catch (error) {
                // Message only, no SQLSTATE: the worst case the Data API is reported to return.
                throw awsError('DatabaseErrorException', `ERROR: ${(error as Error).message}`, error)
            }
            const longAsString = input.resultSetOptions?.longReturnType === 'STRING'
            const columns: ColumnMetadata[] = result.fields.map((field) => ({
                name: field.name,
                label: field.name,
                type: field.dataTypeID,
                typeName: typeNames.get(field.dataTypeID) ?? 'unknown',
            }))
            const records = (result.rows as (string | null)[][]).map((row) =>
                row.map((raw, i) => encodeField(raw, columns[i]!.typeName!, longAsString)),
            )
            if (Buffer.byteLength(JSON.stringify(records)) > RESPONSE_LIMIT_BYTES) {
                throw awsError('DatabaseErrorException', 'Database returned more than the allowed response size limit')
            }
            const dml = ['INSERT', 'UPDATE', 'DELETE', 'MERGE'].includes(result.command)
            return {
                $metadata: {},
                columnMetadata: input.includeResultMetadata ? columns : undefined,
                records,
                numberOfRecordsUpdated: dml ? (result.rowCount ?? 0) : 0,
            }
        } finally {
            if (!inTransaction) await this.#release(client)
        }
    }

    /** `DISCARD ALL` before a connection goes back to the pool — the reset AWS documents. */
    async #release(client: PoolClient): Promise<void> {
        try {
            if (this.#reset) await client.query('DISCARD ALL')
            client.release()
        } catch (error) {
            client.release(error as Error)
        }
    }

    #checkDatabase(database: string | undefined): void {
        if (database !== undefined && database !== this.#database) {
            throw new Error(`emulator serves database "${this.#database}", not "${database}"`)
        }
    }

    /** `pg_type.typname` by oid, which is what PgJDBC reports as a column's type name (`_text` for text[]). */
    // On the connection already held — with `maxConnections: 1` a second checkout would wait forever.
    async #types(client: PoolClient): Promise<Map<number, string>> {
        if (!this.#typeNames) {
            const { rows } = await client.query<{ oid: string; typname: string }>('SELECT oid, typname FROM pg_type')
            this.#typeNames = new Map(rows.map((row) => [Number(row.oid), row.typname]))
        }
        return this.#typeNames
    }
}

function awsError(name: string, message: string, cause?: unknown): Error {
    const error = new Error(message, { cause })
    error.name = name
    return error
}

/**
 * `:name` placeholders to `$n`, in code only — not in strings, E-strings, quoted identifiers, nested
 * comments or dollar quotes, by the dialect's own scanner (`sqlSegments`), so the two cannot disagree —
 * and never the second colon of a `::` cast. Each is bound the way the Data API binds it: an untyped
 * string as `varchar`, a typeHint as its type, a long as `int8` — which is what makes a missing cast fail
 * here.
 */
function toPositional(sql: string, parameters: readonly SqlParameter[]): { text: string; values: unknown[] } {
    const byName = new Map(parameters.map((p) => [p.name, p]))
    const order: string[] = []
    const bind = (_: string, name: string): string => {
        const parameter = byName.get(name)
        if (!parameter) throw awsError('ValidationException', `No value specified for parameter ${name}`)
        let index = order.indexOf(name)
        if (index === -1) index = order.push(name) - 1
        return `($${index + 1}${bindType(parameter)})`
    }
    const text = sqlSegments(sql)
        .map((segment) =>
            segment.code ? segment.text.replace(/(?<!:):([A-Za-z_][A-Za-z0-9_]*)/g, bind) : segment.text,
        )
        .join('')
    const values = order.map((name) => bindValue(byName.get(name)!))
    return { text, values }
}

/** A `Field` read member by member — the SDK types it as a union, one member per kind of value. */
type FieldShape = {
    isNull?: boolean
    stringValue?: string
    longValue?: number
    doubleValue?: number
    booleanValue?: boolean
    blobValue?: Uint8Array
}

const TYPE_HINTS: Record<string, string> = {
    UUID: '::uuid',
    JSON: '::json',
    TIMESTAMP: '::timestamp',
    DATE: '::date',
    TIME: '::time',
    DECIMAL: '::numeric',
}

function bindType(parameter: SqlParameter): string {
    const value: FieldShape = parameter.value ?? {}
    if (value.isNull) return ''
    if (value.stringValue !== undefined)
        return parameter.typeHint ? (TYPE_HINTS[parameter.typeHint] ?? '') : '::varchar'
    if (value.longValue !== undefined) return '::int8'
    if (value.doubleValue !== undefined) return '::float8'
    if (value.booleanValue !== undefined) return '::bool'
    if (value.blobValue !== undefined) return '::bytea'
    return ''
}

function bindValue(parameter: SqlParameter): unknown {
    const value: FieldShape = parameter.value ?? {}
    if (value.isNull) return null
    if (value.blobValue !== undefined) return Buffer.from(value.blobValue)
    return value.stringValue ?? value.longValue ?? value.doubleValue ?? value.booleanValue ?? null
}

const LONG_TYPES = new Set(['int2', 'int4', 'int8', 'oid'])
const DOUBLE_TYPES = new Set(['float4', 'float8'])

function encodeField(raw: string | null, typeName: string, longAsString: boolean): Field {
    if (raw === null) return { isNull: true }
    if (typeName.startsWith('_'))
        return { arrayValue: encodeArray(parseArrayLiteral(raw), typeName.slice(1), longAsString) }
    if (LONG_TYPES.has(typeName)) return longAsString ? { stringValue: raw } : { longValue: Number(raw) }
    if (DOUBLE_TYPES.has(typeName)) return { doubleValue: Number(raw) }
    if (typeName === 'bool') return { booleanValue: raw === 't' }
    if (typeName === 'bytea') return { blobValue: Buffer.from(raw.replace(/^\\x/, ''), 'hex') }
    if (typeName === 'timestamptz') return { stringValue: utcTimestamp(raw) }
    return { stringValue: raw }
}

/** `2026-11-16 23:00:00.123+00` -> `2026-11-16 23:00:00.123`: UTC wall-clock time, as AWS documents. */
function utcTimestamp(raw: string): string {
    return raw.replace(/\+00(?::?00)?$/, '')
}

type Nested = (string | null | Nested)[]

function encodeArray(items: Nested, baseType: string, longAsString: boolean): ArrayValue {
    if (items.some((item) => Array.isArray(item))) {
        return { arrayValues: items.map((item) => encodeArray((item ?? []) as Nested, baseType, longAsString)) }
    }
    const flat = items as (string | null)[]
    if (LONG_TYPES.has(baseType) && !longAsString)
        return { longValues: flat.map((v) => (v === null ? null : Number(v))) as number[] }
    if (DOUBLE_TYPES.has(baseType))
        return { doubleValues: flat.map((v) => (v === null ? null : Number(v))) as number[] }
    if (baseType === 'bool') return { booleanValues: flat.map((v) => (v === null ? null : v === 't')) as boolean[] }
    const strings = baseType === 'timestamptz' ? flat.map((v) => (v === null ? null : utcTimestamp(v))) : flat
    return { stringValues: strings as string[] }
}

/** Postgres's array output (`{a,"b c",NULL,{1,2}}`) to nested arrays of strings and nulls. */
function parseArrayLiteral(text: string): Nested {
    let i = 0
    const parse = (): Nested => {
        const out: Nested = []
        i += 1 // `{`
        while (i < text.length && text[i] !== '}') {
            if (text[i] === ',') {
                i += 1
            } else if (text[i] === '{') {
                out.push(parse())
            } else if (text[i] === '"') {
                let value = ''
                i += 1
                while (text[i] !== '"') {
                    if (text[i] === '\\') i += 1
                    value += text[i]
                    i += 1
                }
                i += 1
                out.push(value)
            } else {
                let value = ''
                while (text[i] !== ',' && text[i] !== '}') value += text[i++]
                out.push(value === 'NULL' ? null : value)
            }
        }
        i += 1 // `}`
        return out
    }
    // A lower-bound decoration (`[0:1]={…}`) only appears for non-default bounds; keel never writes one.
    return parse()
}
