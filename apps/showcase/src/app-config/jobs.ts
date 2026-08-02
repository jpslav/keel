import type { JobHandler } from 'keel/ports/jobs'
import { digestEmailHandler } from 'keel/jobs/digest-email'
import { analyzeBundleHandler } from '@/jobs/analyze-bundle'
import { exportTicketsHandler } from '@/jobs/export-tickets'
import { analyzerOrgSlug } from './actors'

/**
 * The APP's job registrations (the seam side of packages/keel/src/core/jobs.ts, ADR-0012). Kinds compose like
 * migrations do: the framework owns statuses/machine/exportKeyPrefix + FRAMEWORK_JOB_KINDS; the app
 * registers its OWN kinds + handlers here. A real adopter replaces this file (its own kinds/handlers).
 *
 * TWO app kinds, on purpose — a registry with one member proves an extension point exists but never
 * that it composes:
 *   - `export-tickets` reads app rows and writes an artifact (the CSV the desk's SLA sweep mails around).
 *   - `analyze-bundle` reads an app row AND calls the llm port, then writes an artifact. Different
 *     ports, different shape, same handler contract — which is the thing worth proving.
 *
 * COMPOSITION ROOT: `jobHandlers` is the single dispatch map the fake jobs adapter consumes. It merges
 * the framework handler (digest-email) with the app handlers. The framework fake adapter reaches BOTH
 * through this seam because the fence bans framework files from importing `@/jobs/*` directly; the seam
 * (app code) may import them.
 */
export const appJobKinds = ['export-tickets', 'analyze-bundle'] as const
export type AppJobKind = (typeof appJobKinds)[number]

/** One handler per app job kind. Exhaustive over AppJobKind. */
export const appJobHandlers: Record<AppJobKind, JobHandler> = {
    'export-tickets': exportTicketsHandler,
    'analyze-bundle': analyzeBundleHandler,
}

/** The composed dispatch map (framework kinds + app kinds) — the jobs adapter's single source. */
export const jobHandlers: Record<string, JobHandler> = {
    'digest-email': digestEmailHandler,
    ...appJobHandlers,
}

/**
 * Org slugs whose jobs are served by a dedicated service actor (the bundle-analyzer), so the
 * partner-desk's pending-build pool EXCLUDES them — keeping the two actors' pools disjoint. The
 * jobs adapter's listPendingBuilds filters against this list (simulated-mode-only world view).
 */
export const serviceManagedOrgSlugs: readonly string[] = [analyzerOrgSlug]
