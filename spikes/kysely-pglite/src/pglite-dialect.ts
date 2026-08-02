import type { PGlite } from '@electric-sql/pglite'
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

/**
 * Minimal Kysely dialect over pglite. Hand-rolled because the community `kysely-pglite`
 * package predates kysely's `kysely/migration` export split and no longer loads.
 *
 * pglite is a single connection with no concurrent transactions, so the driver hands out
 * one shared connection, serialized by a mutex — good enough for dev and tests, and one
 * more reason all tenant context is transaction-scoped (`SET LOCAL`), never session-level.
 */
export class PGliteDialect implements Dialect {
    constructor(private readonly client: PGlite) {}

    createAdapter() {
        return new PostgresAdapter()
    }
    createDriver(): Driver {
        return new PGliteDriver(this.client)
    }
    createQueryCompiler() {
        return new PostgresQueryCompiler()
    }
    createIntrospector(db: Kysely<any>) {
        return new PostgresIntrospector(db)
    }
}

class PGliteDriver implements Driver {
    readonly #connection: PGliteConnection
    #tail: Promise<void> = Promise.resolve()
    #release: () => void = () => {}

    constructor(client: PGlite) {
        this.#connection = new PGliteConnection(client)
    }

    async init(): Promise<void> {}

    async acquireConnection(): Promise<DatabaseConnection> {
        const prev = this.#tail
        let release!: () => void
        this.#tail = new Promise<void>((resolve) => (release = resolve))
        await prev
        this.#release = release
        return this.#connection
    }

    async releaseConnection(): Promise<void> {
        this.#release()
    }

    async beginTransaction(connection: DatabaseConnection, settings: TransactionSettings): Promise<void> {
        const parts = ['begin']
        if (settings.accessMode) parts.push(settings.accessMode)
        if (settings.isolationLevel) parts.push(`isolation level ${settings.isolationLevel}`)
        await connection.executeQuery(CompiledQuery.raw(parts.join(' ')))
    }

    async commitTransaction(connection: DatabaseConnection): Promise<void> {
        await connection.executeQuery(CompiledQuery.raw('commit'))
    }

    async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
        await connection.executeQuery(CompiledQuery.raw('rollback'))
    }

    async destroy(): Promise<void> {}
}

class PGliteConnection implements DatabaseConnection {
    constructor(private readonly client: PGlite) {}

    async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
        const result = await this.client.query<R>(compiledQuery.sql, [...compiledQuery.parameters])
        return {
            rows: result.rows,
            numAffectedRows: result.affectedRows === undefined ? undefined : BigInt(result.affectedRows),
        }
    }

    streamQuery(): AsyncIterableIterator<never> {
        throw new Error('pglite does not support streaming queries')
    }
}
