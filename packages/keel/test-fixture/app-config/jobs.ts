import { digestEmailHandler } from 'keel/jobs/digest-email'
import type { JobHandler } from 'keel/ports/jobs'
import { exportDocketsHandler } from '../domain/export-dockets'

/**
 * The APP's job registrations (the seam side of keel/core/jobs.ts, ADR-0012).
 *
 * ONE app kind, `export-dockets`, and it must stay non-empty: keel/server-lib/notify.ts builds
 * NOTIFIED_JOB_KINDS out of `appJobKinds`, so `server-lib/notify.test.ts` needs an app kind that
 * notifies AND the framework's own `digest-email` that does not — a distinction an empty registration
 * cannot express.
 *
 * COMPOSITION ROOT: `jobHandlers` is the single dispatch map the fake jobs adapter consumes. The
 * framework reaches its OWN handler through this seam because the fence forbids the adapter importing
 * app-side modules directly.
 */
export const appJobKinds = ['export-dockets'] as const
export type AppJobKind = (typeof appJobKinds)[number]

/**
 * One handler per app job kind, exhaustive over AppJobKind — the map that makes "every registered kind
 * has a handler" a compile-time fact. Deliberately NOT exported: nothing outside this module reads it
 * (keel imports only `jobHandlers` and `serviceManagedOrgSlugs` from here), and an export with no
 * consumer is dead code the gate flags. A real app exports it because its own tests assert on it.
 */
const appJobHandlers: Record<AppJobKind, JobHandler> = {
    'export-dockets': exportDocketsHandler,
}

/** The composed dispatch map (framework kinds + app kinds) — the jobs adapter's single source. */
export const jobHandlers: Record<string, JobHandler> = {
    'digest-email': digestEmailHandler,
    ...appJobHandlers,
}

/**
 * Org slugs whose jobs are served by a dedicated service actor, and are therefore EXCLUDED from the
 * generic pending-build pool (keel/adapters/fake/jobs.ts listPendingBuilds).
 *
 * NON-EMPTY on purpose: `adapters/fake/jobs.test.ts` proves the pool excludes service-managed orgs, and
 * with an empty list that assertion would pass vacuously. `depot` is the fixture's primary org, so the
 * exclusion is visible against jobs the same test submits into its sibling and the other tenant.
 */
export const serviceManagedOrgSlugs: readonly string[] = ['depot']
