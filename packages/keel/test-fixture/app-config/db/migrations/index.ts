import type { Migration } from 'kysely/migration'
import * as m1001 from './1001_dockets'

/**
 * The APP's migrations (the seam side of keel/db/migrations, ADR-0012). Numbering convention: framework
 * 0001–0999, app ≥1001. Composed into the framework registry, which Kysely runs NAME-SORTED — so these
 * run AFTER every framework table exists.
 *
 * This set is the fixture's, and it never meets a host app's: `vitest.contract.config.ts` still points
 * at ONE app, because two 1001+ sets over one database make Kysely report corrupted migrations. The
 * fixture proves `dockets` on pglite only, through the same composed runner.
 */
export const appMigrations: Record<string, Migration> = {
    '1001_dockets': m1001,
}
