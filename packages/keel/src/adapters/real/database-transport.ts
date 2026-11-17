/**
 * How the app reaches Postgres: DATABASE_TRANSPORT, the deployment parameter each app records as
 * `params.database.transport` in its `config/params.ts` (the deployment sets the variable from it). An
 * explicit switch, never inferred from which variables happen to be set — a deployment that
 * half-configures the Data API must fail, not quietly fall back to `pg`.
 *
 * - `pg` (the default): node-postgres over a socket, from a Lambda inside the database's VPC.
 * - `data-api` (opt-in): the RDS Data API over HTTPS, from a Lambda outside any VPC (ADR-0002, addendum
 *   2026-11-16). Its three variables replace DATABASE_URL, and its module is imported only when chosen.
 *
 * Its own module so the migrator Lambda (./migrate-handler.ts) reads the same switch without importing
 * ./index.ts and, with it, every other real adapter's SDK.
 */
export const DATABASE_TRANSPORTS = ['pg', 'data-api'] as const
export type DatabaseTransport = (typeof DATABASE_TRANSPORTS)[number]

export function databaseTransport(): DatabaseTransport {
    const value = process.env.DATABASE_TRANSPORT ?? 'pg'
    if (!(DATABASE_TRANSPORTS as readonly string[]).includes(value)) {
        throw new Error(`DATABASE_TRANSPORT must be one of ${DATABASE_TRANSPORTS.join(', ')} (got "${value}")`)
    }
    return value as DatabaseTransport
}
