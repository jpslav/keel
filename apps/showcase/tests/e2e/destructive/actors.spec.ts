import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { openSimulatorPanel } from '../support/simulator'
import { signInAs } from '../support/people'

/**
 * THE AUTOMATED ACTOR. service-flow.spec.ts drives the service/webhook loop BY HAND; this spec proves
 * the iframe actors drive that exact same loop THEMSELVES — the same HTTP surfaces, in the same
 * order. The runner claims a queued export and completes it (producing a real artifact); the builder
 * console delivers a genuine completion webhook. The pools are disjoint by org (see src/core/
 * actors.ts): the bundle-analyzer services `frontline`, the partner-desk every OTHER org.
 *
 * Destructive: it flips the persisted `jobs-held` world flag ON (a cross-tenant knob), so it lives in
 * the `destructive` project (playwright.config.ts) that only starts once every 'chromium' test
 * finishes, and normalizes the flag + Simulator continuity before and after. Serial: the three tests
 * warm each other's routes and share the held world.
 */

test.describe.configure({ mode: 'serial' })

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

// Normalize before and restore after: hand the world back to the other specs exactly as found.
test.beforeAll(() => {
    setJobsHeld(false)
    clearSimulatorState()
})
test.afterAll(() => {
    setJobsHeld(false)
    clearSimulatorState()
})

/** Sign in as Dana (via the UI) and pin her active org (the endpoint the header OrgSwitcher drives). */
async function signInAndPin(page: Page, orgSlug: string) {
    await signInAs(page, 'person-admin')
    await pinOrg(page, orgSlug)
}

async function pinOrg(page: Page, orgSlug: string) {
    const res = await page.request.post('/api/auth/org', { data: { orgSlug } })
    expect(res.ok(), `pin active org to ${orgSlug}`).toBeTruthy()
}

/** Flip the held world ON via the Simulator flags API — cleaner than driving the Snapshots UI. */
async function enableJobsHeld(request: APIRequestContext) {
    const res = await request.post('/api/simulator/flags', { data: { flag: 'jobs-held', enabled: true } })
    expect(res.ok(), 'enable jobs-held').toBeTruthy()
}

/** A ticket to export, so the CSV artifact carries a real row (not just a header). */
async function addTicket(request: APIRequestContext, body: string) {
    const res = await request.post('/api/tickets', { data: { subject: body } })
    expect(res.ok(), 'add a ticket to export').toBeTruthy()
}

/** Submit an export-tickets job as the signed-in user (pinned org); returns the new job id. */
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
    downloadUrl: string | null
    timeline: { status: string; message: string | null }[]
}

/** The product timeline the user sees: the pinned org's jobs with full status history + download. */
async function productJob(request: APIRequestContext, id: string): Promise<ProductJob | undefined> {
    const res = await request.get('/api/jobs')
    expect(res.ok(), 'read product jobs').toBeTruthy()
    const { jobs } = (await res.json()) as { jobs: ProductJob[] }
    return jobs.find((j) => j.id === id)
}

/** The cross-tenant world view (Simulator Jobs tab feed) — spans every org, so a single poll can
 *  watch both a service-runner job and a builder job drain at once. */
async function worldJob(request: APIRequestContext, id: string): Promise<{ id: string; status: string } | undefined> {
    const res = await request.get('/api/simulator/jobs')
    expect(res.ok(), 'read world jobs').toBeTruthy()
    const { jobs } = (await res.json()) as { jobs: { id: string; status: string }[] }
    return jobs.find((j) => j.id === id)
}

test('stepped bundle-analyzer drives a held frontline export to a real, downloadable artifact', async ({ page }) => {
    // First hits cold-compile the actor route on a fresh dev server — generous room over the default.
    test.setTimeout(120_000)
    const { request } = page

    // A held frontline export parks queued, waiting for its counterparty service to claim it.
    await signInAndPin(page, 'frontline')
    await enableJobsHeld(request)
    await addTicket(request, `actors-service-${Date.now()}`)
    const jobId = await submitExport(request)
    expect((await productJob(request, jobId))?.status, 'held frontline export parks queued').toBe('queued')

    // Open the service actor page PAUSED so we drive it one hop at a time.
    await page.goto('/en/simulator/actors/bundle-analyzer?paused=1', { timeout: 90_000 })
    const shell = page.getByTestId('actor-shell')
    await expect(shell).toBeVisible({ timeout: 60_000 })
    await expect(shell).toHaveAttribute('data-actor', 'bundle-analyzer')
    await expect(page.getByTestId('actor-status')).toHaveAttribute('data-state', 'paused')

    const step = page.getByTestId('actor-step')

    // Step once → the runner claims the queued job (queued → running).
    await step.click()
    await expect
        .poll(async () => (await productJob(request, jobId))?.status, {
            message: 'first step claims the job to running',
            timeout: 30_000,
        })
        .toBe('running')
    await expect(step).toBeEnabled()

    // Step again → it produces the artifact, then reports completion (running → completed with a key).
    await step.click()
    await expect
        .poll(async () => (await productJob(request, jobId))?.status, {
            message: 'second step completes the job',
            timeout: 30_000,
        })
        .toBe('completed')

    const done = await productJob(request, jobId)
    expect(done?.resultKey, 'the completed job carries a real result key').toBeTruthy()

    // No dead link: the signed download URL serves the actual CSV bytes — the whole point of the
    // artifact-truth design (a fabricated key would 404 here).
    expect(done?.downloadUrl, 'a completed job with a key is downloadable').toBeTruthy()
    const dl = await request.get(done!.downloadUrl!)
    expect(dl.status(), 'the artifact downloads').toBe(200)
    expect(dl.headers()['content-type'], 'served as CSV').toContain('text/csv')

    // The process log shows the real HTTP work: a service poll (GET) and status hops (POST).
    const log = page.getByTestId('actor-log')
    await expect(log).toContainText('GET /api/service/jobs')
    await expect(log).toContainText('POST /api/service/jobs/')
})

test('stepped partner-desk delivers a completion webhook for a held platform export', async ({ page }) => {
    test.setTimeout(120_000)
    const { request } = page

    // A held PLATFORM export — the partner-desk's pool (every org that is not the service runner's own).
    await signInAndPin(page, 'platform')
    await enableJobsHeld(request)
    await addTicket(request, `actors-builder-${Date.now()}`)
    const jobId = await submitExport(request)
    expect((await productJob(request, jobId))?.status, 'held platform export parks queued').toBe('queued')

    await page.goto('/en/simulator/actors/partner-desk?paused=1', { timeout: 90_000 })
    const shell = page.getByTestId('actor-shell')
    await expect(shell).toBeVisible({ timeout: 60_000 })
    await expect(shell).toHaveAttribute('data-actor', 'partner-desk')
    await expect(page.getByTestId('actor-status')).toHaveAttribute('data-state', 'paused')

    const step = page.getByTestId('actor-step')

    // One step delivers the completion webhook — a still-queued job is walked queued → running →
    // completed in a single POST, the synthesized running hop labelled 'completion webhook'.
    await step.click()
    await expect
        .poll(async () => (await productJob(request, jobId))?.status, {
            message: 'the webhook completes the build',
            timeout: 30_000,
        })
        .toBe('completed')

    const done = await productJob(request, jobId)
    expect(
        done?.timeline.map((t) => t.status),
        'full lifecycle timeline',
    ).toEqual(['queued', 'running', 'completed'])
    const running = done?.timeline.find((t) => t.status === 'running')
    expect(running?.message, 'the webhook-synthesized running hop is labelled').toBe('completion webhook')

    // The delivered artifact downloads for real (no dead link).
    expect(done?.downloadUrl, 'the completed build is downloadable').toBeTruthy()
    const dl = await request.get(done!.downloadUrl!)
    expect(dl.status(), 'the artifact downloads').toBe(200)
    expect(dl.headers()['content-type'], 'served as CSV').toContain('text/csv')

    // A second step finds nothing left to build — the pool is drained.
    await expect(step).toBeEnabled()
    await step.click()
    await expect(page.getByTestId('actor-log'), 'nothing left to build').toContainText('0 pending')
})

test('the Actors tab autonomously drains both queues with no manual stepping', async ({ page }) => {
    test.setTimeout(120_000)
    const { request } = page

    // Two held exports in disjoint pools: one for the service runner (frontline), one for the builder (platform).
    await signInAndPin(page, 'frontline')
    await enableJobsHeld(request)
    const frontlineJob = await submitExport(request)
    await pinOrg(page, 'platform')
    const platformJob = await submitExport(request)
    expect((await worldJob(request, frontlineJob))?.status, 'frontline export parks queued').toBe('queued')
    expect((await worldJob(request, platformJob))?.status, 'platform export parks queued').toBe('queued')

    // Open the Actors tab in the real UI — both actor frames mount and start running on their own.
    await page.goto('/en/dashboard', { timeout: 90_000 })
    await openSimulatorPanel(page)
    await page.getByTestId('simulator-tab-actors').click()

    await expect(page.getByTestId('actor-frame-bundle-analyzer')).toBeVisible()
    await expect(page.getByTestId('actor-frame-partner-desk')).toBeVisible()

    // Reach INTO each same-origin iframe: neither is paused, so its status settles on running (between
    // near-instant ticks) — the /running|ticking/ regex just proves it is live, not halted.
    const serviceFrame = page.frameLocator('[data-testid="actor-frame-bundle-analyzer"]')
    const builderFrame = page.frameLocator('[data-testid="actor-frame-partner-desk"]')
    await expect(serviceFrame.getByTestId('actor-status'), 'service frame is live').toHaveAttribute(
        'data-state',
        /running|ticking/,
        { timeout: 30_000 },
    )
    await expect(builderFrame.getByTestId('actor-status'), 'builder frame is live').toHaveAttribute(
        'data-state',
        /running|ticking/,
        { timeout: 30_000 },
    )

    // The capstone: NO stepping. The two autonomous actors drive BOTH jobs to completed entirely on
    // their own timers — the hermetic async demo proof.
    await expect
        .poll(
            async () => {
                const r = await worldJob(request, frontlineJob)
                const o = await worldJob(request, platformJob)
                return `${r?.status}/${o?.status}`
            },
            { message: 'both jobs complete autonomously', timeout: 60_000 },
        )
        .toBe('completed/completed')

    // Switching tabs unmounts the Actors tab → the frames leave the DOM and the actors stop.
    await page.getByTestId('simulator-tab-jobs').click()
    await expect(page.getByTestId('actor-frame-bundle-analyzer')).toHaveCount(0)
    await expect(page.getByTestId('actor-frame-partner-desk')).toHaveCount(0)
})
