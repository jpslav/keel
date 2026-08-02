import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { signInAs } from '../support/people'

/**
 * THE MANUAL ACTOR. This spec performs BY HAND exactly the loop the simulated-world iframe actors
 * (bundle-analyzer + vendor console) automate — the same HTTP calls, in the same order, against
 * the same surfaces. The actors replace the hands, not the surface: an in-page actor
 * mints a service token, polls `GET /api/service/jobs`, walks a job queued -> running -> completed
 * via the status route, and later a build POSTs the inbound completion webhook. Everything below is
 * a person doing that manually so the wiring is proven before the automation exists.
 *
 * Destructive: it flips the persisted `jobs-held` world flag ON (a cross-tenant knob that changes how
 * every submitted job behaves), so it must not race the fullyParallel main suite — it lives in the
 * `destructive` project (playwright.config.ts) that only starts once every 'chromium' test finishes.
 * Cleanup resets the flag OFF and clears Simulator continuity so the world is left exactly as found.
 *
 * Two vignettes, two independent held export jobs:
 *   1. service-caller status route — the caller drives its own job forward, with the negative probes
 *      (no token, illegal hop, another tenant's caller) proving the boundary holds.
 *   2. inbound webhook — a second held job is completed by the (real: CodeBuild) completion webhook,
 *      idempotently.
 * All API calls go through page.request so they carry Dana's signed-in session cookie; the service and
 * webhook calls additionally present their own Bearer credential (a JWT / the shared secret).
 */

const flagsFile = path.resolve(__dirname, '../../../.data/analytics/flags.json')
const simulatorState = path.resolve(__dirname, '../../../.data/simulator/state.json')

function setJobsHeld(enabled: boolean) {
    const flags = existsSync(flagsFile) ? (JSON.parse(readFileSync(flagsFile, 'utf8')) as Record<string, boolean>) : {}
    flags['jobs-held'] = enabled
    mkdirSync(path.dirname(flagsFile), { recursive: true })
    writeFileSync(flagsFile, JSON.stringify(flags, null, 2))
}

function clearSimulatorState() {
    try {
        rmSync(simulatorState)
    } catch {
        // never existed / already gone — fine
    }
}

// Normalize before and restore after: a prior aborted run could have left the flag ON or stale
// continuity behind, and we must hand the world back to the other specs exactly as we found it.
test.beforeAll(() => {
    setJobsHeld(false)
    clearSimulatorState()
})
test.afterAll(() => {
    setJobsHeld(false)
    clearSimulatorState()
})

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

/** Sign in as Dana and pin her active org to frontline (the endpoint the header OrgSwitcher drives). */
async function signInAsAdaInResearch(page: Page) {
    await signInAs(page, 'person-admin')
    const res = await page.request.post('/api/auth/org', { data: { orgSlug: 'frontline' } })
    expect(res.ok(), 'pin active org to frontline').toBeTruthy()
}

/** Flip the held world ON via the Simulator flags API — cleaner than driving the Snapshots UI. */
async function enableJobsHeld(request: APIRequestContext) {
    const res = await request.post('/api/simulator/flags', { data: { flag: 'jobs-held', enabled: true } })
    expect(res.ok(), 'enable jobs-held').toBeTruthy()
}

/** Submit an export-tickets job as the signed-in user; returns the new job id. */
async function submitExport(request: APIRequestContext): Promise<string> {
    const res = await request.post('/api/jobs', { data: { kind: 'export-tickets' } })
    expect(res.status(), 'submit export job').toBe(201)
    const { id } = (await res.json()) as { id: string }
    expect(id).toBeTruthy()
    return id
}

interface ProductJob {
    id: string
    status: string
    resultKey: string | null
    timeline: { status: string; message: string | null }[]
}

/** The product timeline the user sees: an org's jobs with full status history. */
async function productJob(request: APIRequestContext, id: string): Promise<ProductJob | undefined> {
    const res = await request.get('/api/jobs')
    expect(res.ok(), 'read product jobs').toBeTruthy()
    const { jobs } = (await res.json()) as { jobs: ProductJob[] }
    return jobs.find((j) => j.id === id)
}

interface Minted {
    token: string
    tenantId: string
    orgId: string
    orgSlug: string
}

/** Mint a short-lived M2M service token for an org (the analog of an org provisioning its creds). */
async function mintToken(request: APIRequestContext, orgSlug: string): Promise<Minted> {
    const res = await request.post('/api/simulator/service-token', { data: { orgSlug } })
    expect(res.ok(), `mint token for ${orgSlug}`).toBeTruthy()
    return (await res.json()) as Minted
}

test('manual service caller drives a held export job queued -> running -> completed, and the boundary holds', async ({
    page,
}) => {
    // First hits cold-compile the service routes on a fresh dev server — generous room over the default.
    test.setTimeout(120_000)
    const { request } = page

    // 1. Held world + a ticket to export, then submit the job. Held -> it parks in `queued`.
    await signInAsAdaInResearch(page)
    await enableJobsHeld(request)
    const noteRes = await request.post('/api/tickets', { data: { subject: `svc-flow-status-${Date.now()}` } })
    expect(noteRes.ok(), 'add a ticket to export').toBeTruthy()
    const jobId = await submitExport(request)

    const queued = await productJob(request, jobId)
    expect(queued?.status, 'job parks queued in the held world').toBe('queued')
    expect(queued?.timeline.map((t) => t.status)).toEqual(['queued'])

    // 2. Mint the org's token and poll the service view — the queued job is there, WITH its payload
    //    (the service view carries payload; the product view does not).
    const frontline = await mintToken(request, 'frontline')
    const pollRes = await request.get('/api/service/jobs?status=queued', { headers: bearer(frontline.token) })
    expect(pollRes.ok(), 'service poll').toBeTruthy()
    const { jobs: serviceJobs } = (await pollRes.json()) as { jobs: { id: string; payload: unknown }[] }
    const seen = serviceJobs.find((j) => j.id === jobId)
    expect(seen, 'the queued job is visible to its org service caller').toBeDefined()
    expect(seen).toHaveProperty('payload')

    // 3. Negative probes on the status route.
    //    (a) No token -> opaque 401.
    const noToken = await request.post(`/api/service/jobs/${jobId}/status`, { data: { status: 'completed' } })
    expect(noToken.status(), 'no token -> 401').toBe(401)
    expect((await noToken.json()).error).toBe('unauthorized')

    //    (b) A caller may not skip a lifecycle step: queued -> completed is a 409, and it names the hop.
    const skipHop = await request.post(`/api/service/jobs/${jobId}/status`, {
        headers: bearer(frontline.token),
        data: { status: 'completed' },
    })
    expect(skipHop.status(), 'queued -> completed is illegal').toBe(409)
    expect(await skipHop.json()).toMatchObject({ error: 'invalid-transition', from: 'queued', to: 'completed' })

    //    (c) A caller from another tenant's org cannot even see the job: a foreign job is
    //        indistinguishable from a missing one -> 404, so ids can't be probed across the boundary.
    const demo = await mintToken(request, 'support-crew')
    const foreign = await request.post(`/api/service/jobs/${jobId}/status`, {
        headers: bearer(demo.token),
        data: { status: 'running' },
    })
    expect(foreign.status(), "another tenant's caller -> 404").toBe(404)

    // 4. Advance it properly, one legal hop at a time.
    const toRunning = await request.post(`/api/service/jobs/${jobId}/status`, {
        headers: bearer(frontline.token),
        data: { status: 'running' },
    })
    expect(toRunning.status(), 'queued -> running').toBe(200)
    expect(await toRunning.json()).toEqual({ ok: true })

    const resultKey = `exports/${frontline.tenantId}/${frontline.orgId}/${jobId}.csv`
    const toCompleted = await request.post(`/api/service/jobs/${jobId}/status`, {
        headers: bearer(frontline.token),
        data: { status: 'completed', resultKey },
    })
    expect(toCompleted.status(), 'running -> completed').toBe(200)
    expect(await toCompleted.json()).toEqual({ ok: true })

    // The product timeline now reads the full story the caller wrote.
    const done = await productJob(request, jobId)
    expect(done?.status).toBe('completed')
    expect(done?.resultKey).toBe(resultKey)
    expect(done?.timeline.map((t) => t.status)).toEqual(['queued', 'running', 'completed'])
})

test('manual inbound webhook completes a second held export job, idempotently', async ({ page }) => {
    test.setTimeout(120_000)
    const { request } = page

    // A second held export job, parked queued.
    await signInAsAdaInResearch(page)
    await enableJobsHeld(request)
    const noteRes = await request.post('/api/tickets', { data: { subject: `svc-flow-webhook-${Date.now()}` } })
    expect(noteRes.ok(), 'add a ticket to export').toBeTruthy()
    const jobId = await submitExport(request)
    expect((await productJob(request, jobId))?.status, 'job parks queued in the held world').toBe('queued')

    // The webhook is addressed by (tenantId, jobId); mint an org token only to learn the tenant and
    // org ids (values the real build would already hold), then fetch the shared inbound-webhook secret.
    const { tenantId, orgId } = await mintToken(request, 'frontline')
    const secretRes = await request.get('/api/simulator/webhook-secret')
    expect(secretRes.ok(), 'reveal webhook secret').toBeTruthy()
    const { secret } = (await secretRes.json()) as { secret: string }

    const resultKey = `exports/${tenantId}/${orgId}/${jobId}.csv`
    const payload = { jobId, tenantId, status: 'completed' as const, resultKey }

    // Wrong secret -> opaque 401, no state change.
    const badSecret = await request.post('/api/webhooks/jobs', { headers: bearer('not-the-secret'), data: payload })
    expect(badSecret.status(), 'wrong secret -> 401').toBe(401)
    expect((await badSecret.json()).error).toBe('unauthorized')

    // Right secret -> 200, applied (not idempotent). Completing a still-queued job walks it through
    // running first, so the timeline always reads queued -> running -> completed; the running hop the
    // webhook synthesizes carries the message 'completion webhook'.
    const applied = await request.post('/api/webhooks/jobs', { headers: bearer(secret), data: payload })
    expect(applied.status(), 'right secret -> 200').toBe(200)
    expect(await applied.json()).toEqual({ ok: true, idempotent: false })

    const done = await productJob(request, jobId)
    expect(done?.status).toBe('completed')
    expect(done?.resultKey).toBe(resultKey)
    expect(done?.timeline.map((t) => t.status)).toEqual(['queued', 'running', 'completed'])
    const running = done?.timeline.find((t) => t.status === 'running')
    expect(running?.message, 'the webhook-synthesized running hop is labelled').toBe('completion webhook')

    // Redelivery of the same terminal completion is expected, not an error: 200, idempotent:true, and
    // the timeline is unchanged (no second running/completed pair).
    const redelivered = await request.post('/api/webhooks/jobs', { headers: bearer(secret), data: payload })
    expect(redelivered.status(), 'redelivery -> 200').toBe(200)
    expect(await redelivered.json()).toEqual({ ok: true, idempotent: true })
    expect((await productJob(request, jobId))?.timeline.map((t) => t.status)).toEqual([
        'queued',
        'running',
        'completed',
    ])
})
