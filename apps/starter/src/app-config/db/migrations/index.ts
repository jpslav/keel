import type { Migration } from 'kysely/migration'
import * as m1001 from './1001_items'

/**
 * The APP's migrations (the seam side of keel/db/migrations, ADR-0012). Numbering convention: framework
 * 0001–0999, app ≥1001. Composed into the framework registry, which Kysely runs NAME-SORTED — so these
 * run AFTER every framework table exists. Add new app migrations here in order.
 */
export const appMigrations: Record<string, Migration> = {
    '1001_items': m1001,
}
