import type { JobHandler } from 'keel/ports/jobs'
import { digestEmailHandler } from 'keel/jobs/digest-email'

/**
 * The APP's job registrations (the seam side of keel/core/jobs.ts, ADR-0012).
 *
 * EMPTY REGISTRATION: no app job kinds, so `AppJobKind` is `never` and `JobKind` collapses to the
 * framework's own. `jobHandlers` is still the composition root the fake jobs adapter consumes, and it
 * still carries the framework's `digest-email` handler — the framework reaches its OWN handler through
 * this seam because the fence forbids the adapter importing app-side modules directly.
 */
export const appJobKinds = [] as const
export type AppJobKind = (typeof appJobKinds)[number]

/** One handler per app job kind. Exhaustive over AppJobKind — which is empty. */
export const appJobHandlers: Record<AppJobKind, JobHandler> = {}

/** The composed dispatch map (framework kinds + app kinds) — the jobs adapter's single source. */
export const jobHandlers: Record<string, JobHandler> = {
    'digest-email': digestEmailHandler,
    ...appJobHandlers,
}

/**
 * Org slugs whose jobs are served by a dedicated service actor, excluded from the generic pending-build
 * pool. EMPTY: this app registers no actors, so no org is service-managed.
 */
export const serviceManagedOrgSlugs: readonly string[] = []
