import type { Migration } from 'kysely/migration'
import * as m1001 from './1001_dockets'
import * as m1002 from './1002_dockets_due_on'

/**
 * The APP's migrations (the seam side of keel/db/migrations, ADR-0012). Numbering convention: framework
 * 0001–0999, app ≥1001. Composed into the framework registry, which Kysely runs NAME-SORTED — so these
 * run AFTER every framework table exists.
 *
 * This set is the fixture's, and it never meets a host app's: two 1001+ sets over one database make
 * Kysely report corrupted migrations. So on real Postgres it gets a database of its own
 * (`keel_contract`, keel/adapters/real/db.contract.test.ts) beside the contract app's, and runs the same
 * composed proof runner there that it runs on pglite.
 */
export const appMigrations: Record<string, Migration> = {
    '1001_dockets': m1001,
    '1002_dockets_due_on': m1002,
}
