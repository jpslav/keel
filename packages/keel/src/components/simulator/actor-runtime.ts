import type { JobStatus } from '../../core/jobs'

/**
 * The Simulator actors' tick logic, isolated from JSX (ADR-0006: src/components screens are
 * router-agnostic; this half is transport-agnostic too). A "driver" is whatever actually talks to
 * the surfaces — real fetch drivers live in the app dir, the static twin closes over in-memory
 * state — so this file can be unit-tested with scripted drivers and reused verbatim by both hosts.
 *
 * Two log fields per entry (see ActorLogEntry): `line` is verbatim technical text (an HTTP call and
 * its status) and is NEVER translated; `note` is localized prose the caller translates at creation
 * time via the `t` it passes in. Each tick performs AT MOST ONE product-visible mutation.
 */

export interface ActorLogEntry {
    at: string
    line: string
    note?: string
}

/** Appends one entry; the shell stamps `at`. `line` = verbatim HTTP text, `note` = localized prose. */
export type ActorLog = (entry: { line: string; note?: string }) => void

/**
 * A note translator bound to the 'simulator' next-intl namespace — the caller passes the function
 * `useTranslations('simulator')` returns. Keys are the `actorNote*` set; `values` fill ICU
 * placeholders. Kept structural (not next-intl's own type) so packages/keel/src/core stays reachable and the
 * static twin can supply its own translator.
 */
export type ActorNoteT = (key: string, values?: Record<string, string | number>) => string

/** A job as the service runner sees it over its poll (no timeline — light polling). */
export interface ServiceJobLike {
    id: string
    kind: string
    status: JobStatus
    createdAt: string
}

/** A pending build the builder-console may deliver a completion webhook for. */
export interface PendingBuildLike {
    jobId: string
    tenantId: string
    tenantSlug: string
    orgSlug: string | null
    kind: string
    status: 'queued' | 'running'
    createdAt: string
}

/**
 * Outcome of a single lifecycle hop against the genuine surface. `failed` = the surface accepted a
 * *failed* terminal report (a job whose handler couldn't produce its artifact) — distinct from
 * `applied` so the runtime narrates it as "reported failed", never as "completed".
 */
export type HopOutcome = 'applied' | 'failed' | 'conflict' | 'gone' | 'unauthorized'
/** A build delivery can additionally be a no-op redelivery of an already-terminal job. */
export type DeliverOutcome = HopOutcome | 'idempotent'

export interface ServiceDriver {
    listJobs(): Promise<ServiceJobLike[]>
    claim(jobId: string): Promise<HopOutcome>
    /** Produces the artifact, then reports the terminal status carrying its key. */
    complete(jobId: string): Promise<HopOutcome>
}

export interface BuilderDriver {
    listBuilds(): Promise<PendingBuildLike[]>
    deliver(build: PendingBuildLike): Promise<DeliverOutcome>
}

/** The service runner's only cross-tick memory: the ids it believes it has claimed. */
export interface ServiceMemory {
    claimed: Set<string>
}

/** Picks the oldest item by ISO createdAt (min) — ISO strings sort chronologically. */
function oldest<T extends { createdAt: string }>(items: T[]): T {
    return items.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b))
}

/**
 * One service-runner tick: poll the team's jobs, then make at most one hop. Completing a running job
 * takes priority over claiming a queued one, so a job never stalls half-done — and because it acts
 * on whatever is `running` (not only ids it remembers claiming), it self-heals after an iframe
 * reload wiped its memory. Claimed-id memory is pruned to ids still present each poll, so a
 * reset-orphaned claim simply vanishes.
 */
export async function serviceTick(
    driver: ServiceDriver,
    memory: ServiceMemory,
    log: ActorLog,
    t: ActorNoteT,
): Promise<void> {
    const jobs = await driver.listJobs()
    log({ line: `GET /api/service/jobs → 200 (${jobs.length} jobs)` })

    const present = new Set(jobs.map((j) => j.id))
    for (const id of [...memory.claimed]) if (!present.has(id)) memory.claimed.delete(id)

    const running = jobs.filter((j) => j.status === 'running')
    if (running.length > 0) {
        const job = oldest(running)
        const outcome = await driver.complete(job.id)
        // Whatever happened, we no longer own this id — a completed, lost, or vanished job is done.
        memory.claimed.delete(job.id)
        logServiceHop(log, t, job.id, outcome, 'complete')
        return
    }

    const queued = jobs.filter((j) => j.status === 'queued')
    if (queued.length > 0) {
        const job = oldest(queued)
        const outcome = await driver.claim(job.id)
        if (outcome === 'applied') memory.claimed.add(job.id)
        logServiceHop(log, t, job.id, outcome, 'claim')
        return
    }

    log({ line: `GET /api/service/jobs → 200 (0 actionable)`, note: t('actorNoteIdle') })
}

function logServiceHop(log: ActorLog, t: ActorNoteT, id: string, outcome: HopOutcome, hop: 'claim' | 'complete'): void {
    const path = `POST /api/service/jobs/${id}/status`
    switch (outcome) {
        case 'applied':
            if (hop === 'claim') log({ line: `${path} → 200 running`, note: t('actorNoteClaimed', { id }) })
            else log({ line: `${path} → 200 completed`, note: t('actorNoteCompleted', { id }) })
            return
        case 'failed':
            log({ line: `${path} → 200 failed`, note: t('actorNoteFailedReported', { id }) })
            return
        case 'conflict':
            log({ line: `${path} → 409`, note: t('actorNoteLostRace') })
            return
        case 'gone':
            log({ line: `${path} → 404`, note: t('actorNoteVanished') })
            return
        case 'unauthorized':
            log({ line: `${path} → 401`, note: t('actorNoteError', { message: 'unauthorized' }) })
            return
    }
}

/**
 * One builder-console tick: poll the pending-build pool, then deliver a completion webhook for the
 * oldest build. The webhook is idempotent by construction (a redelivery of an already-terminal job
 * is a no-op), so the outcome maps cleanly: delivered / redelivered / moved-on / vanished.
 */
export async function builderTick(driver: BuilderDriver, log: ActorLog, t: ActorNoteT): Promise<void> {
    const builds = await driver.listBuilds()
    log({ line: `GET /api/simulator/actors/builds → 200 (${builds.length} builds)` })
    if (builds.length === 0) {
        log({ line: `GET /api/simulator/actors/builds → 200 (0 pending)`, note: t('actorNoteIdle') })
        return
    }

    const build = oldest(builds)
    const outcome = await driver.deliver(build)
    const path = `POST /api/webhooks/jobs`
    switch (outcome) {
        case 'applied':
            log({ line: `${path} → 200`, note: t('actorNoteDelivered', { id: build.jobId }) })
            return
        case 'failed':
            log({ line: `${path} → 200 failed`, note: t('actorNoteFailedReported', { id: build.jobId }) })
            return
        case 'idempotent':
            log({ line: `${path} → 200 (idempotent)`, note: t('actorNoteRedelivered') })
            return
        case 'conflict':
            log({ line: `${path} → 409`, note: t('actorNoteMovedOn') })
            return
        case 'gone':
            log({ line: `${path} → 404`, note: t('actorNoteVanished') })
            return
        case 'unauthorized':
            log({ line: `${path} → 401`, note: t('actorNoteError', { message: 'unauthorized' }) })
            return
    }
}
