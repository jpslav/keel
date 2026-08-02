import type { Migration } from 'kysely/migration'
import * as m1001 from './1001_tickets'
import * as m1002 from './1002_escalations'
import * as m1003 from './1003_attachments'
import * as m1004 from './1004_tickets_keyset_index'

/**
 * The APP's migrations (the seam side of packages/keel/src/db/migrations, ADR-0012). Numbering convention: framework
 * 0001–0999, app ≥1001. Composed into the framework registry (packages/keel/src/db/migrations/index.ts), which Kysely
 * runs NAME-SORTED — so these run AFTER every framework table exists. Safe because app tables only
 * reference framework tables (organizations), never the reverse. A real adopter replaces these with its
 * own ≥1001 migrations. Add new app migrations here in order.
 *
 * These three were renamed (notes→tickets, org_requests→escalations, artifacts→attachments) when the
 * showcase became a support desk. Kysely keys applied migrations by NAME, so a rename makes it see an
 * unapplied migration next to an orphaned record — safe only pre-cutover, and only after wiping local
 * `apps/showcase/.data`. See docs/build-notes.md.
 */
export const appMigrations: Record<string, Migration> = {
    '1001_tickets': m1001,
    '1002_escalations': m1002,
    '1003_attachments': m1003,
    '1004_tickets_keyset_index': m1004,
}
