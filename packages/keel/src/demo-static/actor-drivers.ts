import type { Dispatch, RefObject, SetStateAction } from 'react'
import type {
    ActorLog,
    BuilderDriver,
    ServiceDriver,
    HopOutcome,
    PendingBuildLike,
    ServiceJobLike,
} from '../components/simulator/actor-runtime'
import type { DemoJob } from './rows'

/**
 * The static twin's actor drivers (ADR-0006: FULL parity, no server). Same ServiceDriver/BuilderDriver
 * contracts the real fetch drivers implement (src/app/[locale]/simulator/actors/[actor]/drivers.ts),
 * so the SAME serviceTick/builderTick from ../components/simulator/actor-runtime.ts drive both hosts
 * verbatim — only the transport differs. There is no token/secret to mint here (no server to talk to),
 * so unlike the real drivers these never produce an `unauthorized` outcome.
 *
 * WHICH team each actor serves is app vocabulary (@app-config/actors, @app-config/jobs), so it arrives
 * as a scope argument rather than being read here — the drivers themselves only know jobs, which the
 * framework owns.
 *
 * DEGRADE (documented like the export twin's own note in ./world.ts): completing a job here can't
 * produce a downloadable artifact — the static shell has no server to serve CSV bytes from — so the
 * completed timeline entry carries no resultKey/downloadUrl. The `POST /api/simulator/actors/artifact`
 * call the real driver makes before completing is mirrored as an in-memory log line only.
 */
interface DemoDriverDeps {
    /** Always-current mirror of the world's jobs (an effect-synced ref) — reading through a ref rather
     *  than a stale closure over the state value lets these drivers stay valid across ticks without
     *  being reconstructed. */
    jobsRef: RefObject<DemoJob[]>
    setJobs: Dispatch<SetStateAction<DemoJob[]>>
    log: ActorLog
}

/** The one team a service actor is scoped to — the twin of its minted token's tenant/org claims. */
export interface DemoServiceScope {
    tenantSlug: string
    orgSlug: string
}

export function createDemoServiceDriver(
    { jobsRef, setJobs, log }: DemoDriverDeps,
    scope: DemoServiceScope,
): ServiceDriver {
    return {
        async listJobs(): Promise<ServiceJobLike[]> {
            // Mirrors GET /api/service/jobs scoped to a token minted for this team — the token's own
            // claims are what narrow it server-side, so the twin filters by the same two slugs.
            return jobsRef.current
                .filter((job) => job.tenantSlug === scope.tenantSlug && job.orgSlug === scope.orgSlug)
                .map((job) => ({
                    id: job.id,
                    kind: job.kind,
                    status: job.status as ServiceJobLike['status'],
                    createdAt: job.createdAt,
                }))
        },
        async claim(jobId: string): Promise<HopOutcome> {
            const job = jobsRef.current.find((j) => j.id === jobId)
            if (!job) return 'gone'
            if (job.status !== 'queued') return 'conflict'
            const at = new Date().toISOString()
            setJobs((prev) =>
                prev.map((j) =>
                    j.id === jobId && j.status === 'queued'
                        ? {
                              ...j,
                              status: 'running',
                              timeline: [...j.timeline, { status: 'running', at, message: null }],
                          }
                        : j,
                ),
            )
            return 'applied'
        },
        async complete(jobId: string): Promise<HopOutcome> {
            const job = jobsRef.current.find((j) => j.id === jobId)
            if (!job) return 'gone'
            if (job.status !== 'running') return 'conflict'
            // The real driver logs the artifact-production POST before reporting completion — this
            // is that same call shape, adapted for a host with no storage to write to (see DEGRADE
            // note above).
            log({ line: 'POST /api/simulator/actors/artifact → 200 (in-memory, no file)' })
            const at = new Date().toISOString()
            setJobs((prev) =>
                prev.map((j) =>
                    j.id === jobId && j.status === 'running'
                        ? {
                              ...j,
                              status: 'completed',
                              timeline: [...j.timeline, { status: 'completed', at, message: null }],
                          }
                        : j,
                ),
            )
            return 'applied'
        },
    }
}

export function createDemoBuilderDriver(
    { jobsRef, setJobs, log }: DemoDriverDeps,
    /** Teams already served by a dedicated service actor (@app-config/jobs' serviceManagedOrgSlugs) —
     *  excluded so the two actors' job pools stay disjoint, exactly like listPendingBuilds. */
    serviceManagedOrgSlugs: readonly string[],
): BuilderDriver {
    return {
        async listBuilds(): Promise<PendingBuildLike[]> {
            // Mirrors GET /api/simulator/actors/builds: every non-terminal job whose org is NOT
            // service-managed (or has none) — the builder-console's disjoint pool.
            const builds = jobsRef.current
                .filter(
                    (job) =>
                        (job.status === 'queued' || job.status === 'running') &&
                        !serviceManagedOrgSlugs.includes(job.orgSlug ?? ''),
                )
                .map((job) => ({
                    jobId: job.id,
                    // The twin has no real tenant ids (a seed package only carries slugs) — the
                    // interface field is structural here, never dereferenced against real storage.
                    tenantId: job.tenantSlug,
                    tenantSlug: job.tenantSlug,
                    orgSlug: job.orgSlug,
                    kind: job.kind,
                    status: job.status as 'queued' | 'running',
                    createdAt: job.createdAt,
                }))
            return builds
        },
        async deliver(build: PendingBuildLike) {
            const job = jobsRef.current.find((j) => j.id === build.jobId)
            if (!job) return 'gone'
            if (job.status !== 'queued' && job.status !== 'running' && job.status !== 'completed') return 'conflict'
            // Real webhook delivery always re-runs the artifact handler first, even for an already-
            // terminal (idempotent) job — mirror that call shape unconditionally too.
            log({ line: 'POST /api/simulator/actors/artifact → 200 (in-memory, no file)' })
            if (job.status === 'completed') return 'idempotent'
            const now = Date.now()
            setJobs((prev) =>
                prev.map((j) => {
                    if (j.id !== build.jobId || j.status === 'completed') return j
                    const timeline = [...j.timeline]
                    // Same single-POST double-hop the real webhook route performs (../db/jobs.ts):
                    // a still-queued job walks through running (message 'completion webhook') first.
                    if (j.status === 'queued') {
                        timeline.push({
                            status: 'running',
                            at: new Date(now).toISOString(),
                            message: 'completion webhook',
                        })
                    }
                    timeline.push({ status: 'completed', at: new Date(now + 50).toISOString(), message: null })
                    return { ...j, status: 'completed', timeline }
                }),
            )
            return 'applied'
        },
    }
}
