import { RDSDataClient } from '@aws-sdk/client-rds-data'
import { Kysely } from 'kysely'
import type { DB } from '../../db/schema'
import type { DbPort } from '../../ports/db'
import { dbPortFor } from './db'
import { RdsDataDialect, type RdsDataClientLike } from './rds-data-dialect'

export interface DataApiDbConfig {
    /** The Aurora cluster's ARN; the cluster must have the Data API enabled. */
    resourceArn: string
    /** The Secrets Manager secret holding the database credentials the Data API connects with. */
    secretArn: string
    database: string
    /** Omitted: the SDK's own region resolution (AWS_REGION in Lambda). */
    region?: string
    /** Injected only by the contract suite, which runs the dialect against its emulator. */
    client?: RdsDataClientLike
}

/**
 * The opt-in transport (`DATABASE_TRANSPORT=data-api`): the `db` port over the RDS Data API, for a
 * Lambda outside any VPC — no NAT, no socket, IAM instead of a network path (ADR-0002, addendum
 * 2026-11-16). AUTHORED — CUTOVER (`data-api`).
 *
 * Its own module, reached ONLY by dynamic import (./index.ts, ./migrate-handler.ts), so a `pg`
 * deployment never loads the RDS Data SDK; ./index.test.ts proves it.
 *
 * `maxAttempts: 1` turns the SDK's automatic retries off, on AWS's own advice: a statement whose call
 * timed out may still have finished, and retrying it can write twice. The one failure that is safe to
 * retry (a paused Serverless v2 resuming) is retried by the dialect itself.
 */
export function createRealDataApiDb(config: DataApiDbConfig): DbPort {
    const client = config.client ?? new RDSDataClient({ region: config.region, maxAttempts: 1 })
    const dialect = new RdsDataDialect({
        client,
        resourceArn: config.resourceArn,
        secretArn: config.secretArn,
        database: config.database,
    })
    return dbPortFor(new Kysely<DB>({ dialect }))
}
