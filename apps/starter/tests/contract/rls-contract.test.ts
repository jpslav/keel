import { contractDatabaseName } from '../../../../tests/support/contract-postgres'
import { defineContractSuite } from '../../../../tests/support/contract-suite'
import { APP_SLUG } from '../../config/app'

/**
 * The "fakes can't drift" job for this app: the SAME migrations + RLS proof suite that runs on pglite in unit
 * tests, executed against REAL Postgres, in a database of this app's own (`<slug>_contract`), by a non-superuser
 * owner and by a superuser. Everything but the database's name is the suite's (tests/support/contract-suite.ts),
 * which is why every app's file is these lines.
 *
 * Run via `pnpm test:contract` — deliberately not part of the fast unit suite. Locally that's embedded-postgres
 * binaries (no docker on the dev VM); in CI, CONTRACT_DATABASE_URL names a postgres service container.
 */
defineContractSuite({ database: contractDatabaseName(APP_SLUG) })
