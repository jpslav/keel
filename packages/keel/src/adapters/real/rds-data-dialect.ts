import { randomUUID } from 'node:crypto'
import {
    BeginTransactionCommand,
    CommitTransactionCommand,
    ExecuteStatementCommand,
    RollbackTransactionCommand,
    type BeginTransactionCommandOutput,
    type ExecuteStatementCommandOutput,
} from '@aws-sdk/client-rds-data'
import {
    CompiledQuery,
    PostgresAdapter,
    PostgresIntrospector,
    PostgresQueryCompiler,
    type DatabaseConnection,
    type Dialect,
    type Driver,
    type Kysely,
    type QueryResult,
    type TransactionSettings,
} from 'kysely'
import {
    castPlaceholder,
    decodeRow,
    leadingKeyword,
    normalizeDatabaseError,
    RdsDataUnsupportedError,
    rewritePlaceholders,
    toSqlParameter,
    unsupportedStatement,
} from './rds-data-codec'

/** The four calls this dialect makes. `RDSDataClient` satisfies it, and so does the test emulator. */
export type RdsDataCommand =
    BeginTransactionCommand | CommitTransactionCommand | RollbackTransactionCommand | ExecuteStatementCommand

export interface RdsDataClientLike {
    send(command: RdsDataCommand): Promise<unknown>
    destroy?(): void
}

export interface RdsDataDialectConfig {
    client: RdsDataClientLike
    /** The Aurora cluster's ARN (the Data API must be enabled on it). */
    resourceArn: string
    /** The Secrets Manager secret holding the database user's credentials. */
    secretArn: string
    database: string
}

/**
 * Kysely over the Amazon RDS Data API: Postgres's adapter, compiler and introspector, with a driver that
 * speaks HTTPS to the Data API instead of the wire protocol to a socket. ADR-0002's addendum of
 * 2026-11-16 records why it exists (a Lambda outside any VPC, with no NAT, reaching Aurora) and why it is
 * written here rather than taken from the community `kysely-data-api`.
 *
 * A "connection" is a handle with an optional transaction id; there is no socket and nothing to pool.
 * Statements outside a transaction are independent HTTPS calls, each autocommitted, and the Data API
 * resets the session (`DISCARD ALL`) between them — so session state exists only inside a transaction,
 * which is the one place keel ever sets it (`runWithTenant`'s `SET LOCAL ROLE` and
 * `set_config(…, true)`). What it cannot do fails loudly (./rds-data-codec.ts, `unsupportedStatement`):
 * streaming, transaction control in SQL, session state outside a transaction.
 *
 * AUTHORED — CUTOVER (`data-api`): proven against real Postgres through a strict emulator
 * (./rds-data-emulator.ts, `pnpm test:contract`); never run against the Data API itself.
 */
export class RdsDataDialect implements Dialect {
    constructor(private readonly config: RdsDataDialectConfig) {}

    createAdapter() {
        return new PostgresAdapter()
    }
    createDriver(): Driver {
        return new RdsDataDriver(this.config)
    }
    createQueryCompiler() {
        return new PostgresQueryCompiler()
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- kysely's Dialect interface signature
    createIntrospector(db: Kysely<any>) {
        return new PostgresIntrospector(db)
    }
}

/** How many SQL texts' parameter types are remembered before the cache starts over. */
const TYPE_CACHE_LIMIT = 2000

/**
 * A paused Aurora Serverless v2 (min capacity 0, as keel's non-production stack runs) answers the first
 * call with DatabaseResumingException: the request was cancelled, not run, so retrying it is safe. Every
 * other failure is NOT retried — the SDK's own retries are off (`maxAttempts: 1` in ./db.ts) because AWS
 * warns that a retried statement whose first attempt actually finished can write twice.
 */
const RESUME_DELAYS_MS = [1000, 2000, 4000, 8000]

class RdsDataDriver implements Driver {
    readonly #types = new Map<string, readonly string[]>()

    constructor(private readonly config: RdsDataDialectConfig) {}

    async init(): Promise<void> {}

    async acquireConnection(): Promise<DatabaseConnection> {
        return new RdsDataConnection(this)
    }

    async releaseConnection(): Promise<void> {}

    async beginTransaction(connection: DatabaseConnection, settings: TransactionSettings): Promise<void> {
        const conn = asConnection(connection)
        if (conn.transactionId) throw new RdsDataUnsupportedError('a transaction is already open on this connection')
        const { resourceArn, secretArn, database } = this.config
        const begun = (await this.call(
            new BeginTransactionCommand({ resourceArn, secretArn, database }),
        )) as BeginTransactionCommandOutput
        if (!begun.transactionId) throw new Error('RDS Data API: BeginTransaction returned no transaction id')
        conn.transactionId = begun.transactionId
        // BeginTransaction takes no isolation level or access mode; Postgres accepts them as the
        // transaction's first statement instead.
        const modes = [
            settings.isolationLevel ? `isolation level ${settings.isolationLevel}` : '',
            settings.accessMode ?? '',
        ].filter(Boolean)
        if (modes.length > 0) await conn.executeQuery(CompiledQuery.raw(`set transaction ${modes.join(' ')}`))
    }

    async commitTransaction(connection: DatabaseConnection): Promise<void> {
        const transactionId = takeTransaction(connection)
        const { resourceArn, secretArn } = this.config
        await this.call(new CommitTransactionCommand({ resourceArn, secretArn, transactionId }))
    }

    async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
        const transactionId = takeTransaction(connection)
        const { resourceArn, secretArn } = this.config
        try {
            await this.call(new RollbackTransactionCommand({ resourceArn, secretArn, transactionId }))
        } catch (error) {
            // Already gone means already rolled back: the Data API rolls a transaction back itself when it
            // idles for three minutes or reaches an hour. Rethrowing would only replace the error that
            // made Kysely roll back with one that says nothing about it.
            if (error instanceof Error && error.name === 'TransactionNotFoundException') return
            throw error
        }
    }

    async savepoint(connection: DatabaseConnection, name: string): Promise<void> {
        await connection.executeQuery(CompiledQuery.raw(`savepoint ${quoteIdent(name)}`))
    }

    async rollbackToSavepoint(connection: DatabaseConnection, name: string): Promise<void> {
        await connection.executeQuery(CompiledQuery.raw(`rollback to savepoint ${quoteIdent(name)}`))
    }

    async releaseSavepoint(connection: DatabaseConnection, name: string): Promise<void> {
        await connection.executeQuery(CompiledQuery.raw(`release savepoint ${quoteIdent(name)}`))
    }

    async destroy(): Promise<void> {
        this.config.client.destroy?.()
    }

    async execute(compiled: CompiledQuery, transactionId: string | undefined): Promise<QueryResult<unknown>> {
        const problem = unsupportedStatement(compiled.sql, transactionId !== undefined)
        if (problem) throw new RdsDataUnsupportedError(problem)

        let sql = compiled.sql
        let parameters: ReturnType<typeof toSqlParameter>[] | undefined
        if (compiled.parameters.length > 0) {
            const types = await this.parameterTypes(compiled.sql, transactionId)
            if (types.length !== compiled.parameters.length) {
                throw new Error(
                    `RDS Data API: Postgres reports ${types.length} parameters for a statement sent ${compiled.parameters.length}`,
                )
            }
            sql = rewritePlaceholders(compiled.sql, (n) => castPlaceholder(n, types[n - 1]))
            parameters = compiled.parameters.map((value, i) => toSqlParameter(i + 1, value))
        }

        const out = await this.statement(sql, transactionId, parameters)
        const columns = out.columnMetadata ?? []
        const rows = (out.records ?? []).map((record) => decodeRow(record, columns))
        const keyword = leadingKeyword(compiled.sql)
        const updated = out.numberOfRecordsUpdated
        const isDml = keyword === 'insert' || keyword === 'update' || keyword === 'delete' || keyword === 'merge'
        return {
            rows,
            numAffectedRows:
                isDml || (keyword === 'with' && updated !== undefined && updated > 0)
                    ? BigInt(updated ?? 0)
                    : undefined,
        }
    }

    /**
     * The types Postgres infers for `sql`'s `$n` placeholders — the same inference node-postgres relies
     * on — read back from `pg_prepared_statements` after a PREPARE, and cached by SQL text (Kysely
     * compiles one text per query shape, so a warm process asks once per shape).
     *
     * Inside a transaction it asks there, so a table the transaction has just created is visible to the
     * PREPARE; a PREPARE that fails has found the same error the statement would have, and aborts the
     * transaction exactly as the statement would. Outside one it opens a short transaction of its own,
     * because PREPARE and the read of `pg_prepared_statements` must share a connection.
     */
    private async parameterTypes(sql: string, transactionId: string | undefined): Promise<readonly string[]> {
        const cached = this.#types.get(sql)
        if (cached) return cached

        const name = `keel_describe_${randomUUID().replace(/-/g, '')}`
        const describe = async (txId: string): Promise<readonly string[]> => {
            await this.statement(`PREPARE ${name} AS ${sql}`, txId)
            const out = await this.statement(
                `SELECT parameter_types::text[] AS types FROM pg_prepared_statements WHERE name = '${name}'`,
                txId,
            )
            await this.statement(`DEALLOCATE ${name}`, txId)
            const types = out.records?.[0]?.[0]?.arrayValue?.stringValues
            if (!types || types.some((type) => type === null)) {
                throw new Error('RDS Data API: could not read the parameter types Postgres inferred')
            }
            return types as string[]
        }

        let types: readonly string[]
        if (transactionId) {
            types = await describe(transactionId)
        } else {
            const { resourceArn, secretArn, database } = this.config
            const begun = (await this.call(
                new BeginTransactionCommand({ resourceArn, secretArn, database }),
            )) as BeginTransactionCommandOutput
            const txId = begun.transactionId!
            try {
                types = await describe(txId)
            } finally {
                await this.call(new RollbackTransactionCommand({ resourceArn, secretArn, transactionId: txId })).catch(
                    () => undefined,
                )
            }
        }

        if (this.#types.size >= TYPE_CACHE_LIMIT) this.#types.clear()
        this.#types.set(sql, types)
        return types
    }

    private async statement(
        sql: string,
        transactionId: string | undefined,
        parameters?: ReturnType<typeof toSqlParameter>[],
    ): Promise<ExecuteStatementCommandOutput> {
        const { resourceArn, secretArn, database } = this.config
        return (await this.call(
            new ExecuteStatementCommand({
                resourceArn,
                secretArn,
                database,
                sql,
                parameters,
                transactionId,
                includeResultMetadata: true,
                // int8 and numeric come back as strings, as node-postgres returns them, instead of a JS
                // number that silently loses precision past 2^53.
                resultSetOptions: { decimalReturnType: 'STRING', longReturnType: 'STRING' },
            }),
        )) as ExecuteStatementCommandOutput
    }

    private async call(command: RdsDataCommand): Promise<unknown> {
        for (let attempt = 0; ; attempt += 1) {
            try {
                return await this.config.client.send(command)
            } catch (error) {
                const resuming = error instanceof Error && error.name === 'DatabaseResumingException'
                if (resuming && attempt < RESUME_DELAYS_MS.length) {
                    await new Promise((resolve) => setTimeout(resolve, RESUME_DELAYS_MS[attempt]))
                    continue
                }
                throw normalizeDatabaseError(error)
            }
        }
    }
}

class RdsDataConnection implements DatabaseConnection {
    transactionId: string | undefined

    constructor(private readonly driver: RdsDataDriver) {}

    async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
        return (await this.driver.execute(compiledQuery, this.transactionId)) as QueryResult<R>
    }

    // eslint-disable-next-line require-yield -- an async generator that refuses before its first chunk
    async *streamQuery(): AsyncIterableIterator<never> {
        throw new RdsDataUnsupportedError('the Data API returns whole result sets (at most 1 MiB); it cannot stream')
    }
}

function asConnection(connection: DatabaseConnection): RdsDataConnection {
    if (!(connection instanceof RdsDataConnection)) throw new Error('not an RDS Data API connection')
    return connection
}

function takeTransaction(connection: DatabaseConnection): string {
    const conn = asConnection(connection)
    const transactionId = conn.transactionId
    if (!transactionId) throw new Error('RDS Data API: no transaction is open on this connection')
    conn.transactionId = undefined
    return transactionId
}

function quoteIdent(name: string): string {
    return `"${name.replace(/"/g, '""')}"`
}
