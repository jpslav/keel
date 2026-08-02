import { analyzerOrgSlug } from '@app-config/actors'
import type {
    ActorLog,
    ActorNoteT,
    BuilderDriver,
    ServiceDriver,
    HopOutcome,
    PendingBuildLike,
    ServiceJobLike,
} from 'keel/components/simulator/actor-runtime'

/**
 * The REAL actor drivers: client-side fetch against the exact same surfaces a real counterparty
 * would hit (ADR-0006 — transport lives in the app dir, never in src/components). Credentials are
 * minted lazily and cached; any 401 clears the cache, re-mints, and retries the failed call ONCE
 * within the same tick — after that it surfaces as `unauthorized`. Token/secret VALUES are never
 * logged. The runtime (actor-runtime.ts) logs the primary GET/POST lines from each outcome; these
 * drivers log only the auxiliary calls (mint, artifact, secret) and the credential-refresh note, so
 * the two interleave into one coherent process log without duplication.
 */

interface DriverDeps {
    log: ActorLog
    t: ActorNoteT
}

const json = { 'content-type': 'application/json' }

function outcomeFromStatus(status: number): HopOutcome | null {
    if (status === 200) return 'applied'
    if (status === 409) return 'conflict'
    if (status === 404) return 'gone'
    if (status === 401) return 'unauthorized'
    return null
}

export function createServiceDriver({ log, t }: DriverDeps): ServiceDriver {
    let token: string | null = null
    let tenantId: string | null = null

    async function mint(refresh: boolean): Promise<void> {
        const res = await fetch('/api/simulator/service-token', {
            method: 'POST',
            headers: json,
            body: JSON.stringify({ orgSlug: analyzerOrgSlug }),
        })
        if (!res.ok) throw new Error(`service-token → ${res.status}`)
        const minted = (await res.json()) as { token: string; tenantId: string }
        token = minted.token
        tenantId = minted.tenantId
        // Never log the token value — just that a fresh one was obtained.
        log(
            refresh
                ? {
                      line: 'POST /api/simulator/service-token → 200 (re-mint)',
                      note: t('actorNoteCredentialsRefreshed'),
                  }
                : { line: 'POST /api/simulator/service-token → 200' },
        )
    }

    async function authed(input: string, init: RequestInit, retried = false): Promise<Response> {
        if (!token) await mint(false)
        const res = await fetch(input, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } })
        if (res.status === 401 && !retried) {
            token = null
            await mint(true)
            return authed(input, init, true)
        }
        return res
    }

    async function statusHop(jobId: string, body: Record<string, unknown>): Promise<HopOutcome> {
        const res = await authed(`/api/service/jobs/${jobId}/status`, {
            method: 'POST',
            headers: json,
            body: JSON.stringify(body),
        })
        const outcome = outcomeFromStatus(res.status)
        if (outcome === null) throw new Error(`status route → ${res.status}`)
        return outcome
    }

    return {
        async listJobs() {
            const res = await authed('/api/service/jobs', { method: 'GET' })
            if (!res.ok) {
                if (res.status === 401) return [] // credentials never recovered — idle this tick
                throw new Error(`service jobs → ${res.status}`)
            }
            const { jobs } = (await res.json()) as { jobs: ServiceJobLike[] }
            return jobs.map((j) => ({ id: j.id, kind: j.kind, status: j.status, createdAt: j.createdAt }))
        },
        claim(jobId) {
            return statusHop(jobId, { status: 'running' })
        },
        async complete(jobId) {
            if (!tenantId) await mint(false)
            // Produce the artifact FIRST, so the completed status references a real, downloadable
            // file (no dead links). Then report the terminal status over the genuine surface.
            const artRes = await fetch('/api/simulator/actors/artifact', {
                method: 'POST',
                headers: json,
                body: JSON.stringify({ tenantId, jobId }),
            })
            if (!artRes.ok) throw new Error(`artifact → ${artRes.status}`)
            const artifact = (await artRes.json()) as { resultKey?: string; error?: string }
            log({ line: 'POST /api/simulator/actors/artifact → 200' })
            if (artifact.error !== undefined) {
                // Dead path for export-tickets (its handler always produces a CSV). A future failing
                // kind would land here: report failed truthfully. Return 'failed' (not the raw
                // 'applied') so the runtime narrates "reported failed", never "completed" — the
                // narration is owned in one place (logServiceHop), never here.
                const outcome = await statusHop(jobId, { status: 'failed', error: artifact.error })
                return outcome === 'applied' ? 'failed' : outcome
            }
            return statusHop(jobId, { status: 'completed', resultKey: artifact.resultKey })
        },
    }
}

export function createBuilderDriver({ log, t }: DriverDeps): BuilderDriver {
    let secret: string | null = null

    async function fetchSecret(refresh: boolean): Promise<void> {
        const res = await fetch('/api/simulator/webhook-secret')
        if (!res.ok) throw new Error(`webhook-secret → ${res.status}`)
        secret = ((await res.json()) as { secret: string }).secret
        log(
            refresh
                ? {
                      line: 'GET /api/simulator/webhook-secret → 200 (refresh)',
                      note: t('actorNoteCredentialsRefreshed'),
                  }
                : { line: 'GET /api/simulator/webhook-secret → 200' },
        )
    }

    async function webhookPost(body: Record<string, unknown>, retried = false): Promise<Response> {
        if (!secret) await fetchSecret(false)
        const res = await fetch('/api/webhooks/jobs', {
            method: 'POST',
            headers: { ...json, Authorization: `Bearer ${secret}` },
            body: JSON.stringify(body),
        })
        if (res.status === 401 && !retried) {
            secret = null
            await fetchSecret(true)
            return webhookPost(body, true)
        }
        return res
    }

    return {
        async listBuilds() {
            const res = await fetch('/api/simulator/actors/builds')
            if (!res.ok) throw new Error(`builds → ${res.status}`)
            const { builds } = (await res.json()) as { builds: PendingBuildLike[] }
            return builds
        },
        async deliver(build) {
            // Produce the artifact first so the completed webhook references a real file (no dead link).
            const artRes = await fetch('/api/simulator/actors/artifact', {
                method: 'POST',
                headers: json,
                body: JSON.stringify({ tenantId: build.tenantId, jobId: build.jobId }),
            })
            if (!artRes.ok) throw new Error(`artifact → ${artRes.status}`)
            const artifact = (await artRes.json()) as { resultKey?: string; error?: string }
            log({ line: 'POST /api/simulator/actors/artifact → 200' })
            const reportedFailure = artifact.error !== undefined
            const body = reportedFailure
                ? { jobId: build.jobId, tenantId: build.tenantId, status: 'failed', error: artifact.error }
                : { jobId: build.jobId, tenantId: build.tenantId, status: 'completed', resultKey: artifact.resultKey }
            const res = await webhookPost(body)
            if (res.status === 200) {
                const { idempotent } = (await res.json()) as { idempotent?: boolean }
                // A newly-applied failure narrates as 'failed'; a redelivery is idempotent either way.
                return idempotent ? 'idempotent' : reportedFailure ? 'failed' : 'applied'
            }
            if (res.status === 409) return 'conflict'
            if (res.status === 404) return 'gone'
            if (res.status === 401) return 'unauthorized'
            throw new Error(`webhook → ${res.status}`)
        },
    }
}
