import { rmSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { openSimulatorPanel } from '../support/simulator'
import { setWorldFlag } from '../support/world-flags'

/**
 * Destructive: this spec flips the persisted `jobs-held` world flag ON (a full-page reload in the
 * real app, and a cross-tenant knob that changes how EVERY submitted job behaves), so it must not
 * race the fullyParallel main suite — it lives in the `destructive` project (see playwright.config.ts)
 * that only starts once every 'chromium' test has finished. Cleanup resets the flag OFF and clears
 * Simulator continuity so the world is left exactly as found.
 */

const simulatorState = path.resolve(__dirname, '../../../.data/simulator/state.json')

function clearSimulatorState() {
    try {
        rmSync(simulatorState)
    } catch {
        // never existed / already gone — fine
    }
}

// Start from a known-off flag (a prior aborted run could have left it ON — then the toggle click
// would turn it OFF instead of ON) and no stale continuity, and leave both that way afterwards.
test.beforeAll(() => {
    setWorldFlag('jobs-held', false)
    // The actors run from page load and would claim a held job before this spec drives it by hand.
    setWorldFlag('actors-held', true)
    clearSimulatorState()
})
test.afterAll(() => {
    setWorldFlag('jobs-held', false)
    setWorldFlag('actors-held', false)
    clearSimulatorState()
})

async function signInAs(page: Page, personId: string) {
    await page.goto('/en/signin')
    await page.getByTestId(`person-${personId}`).click()
    await page.waitForURL('**/dashboard')
}

// The newest job across all tenants is the one we just submitted (world list is created-at desc), so
// the first row (excluding the nested expand toggles) is ours regardless of what chromium left behind.
function firstWorldJobRow(page: Page) {
    return page.locator('[data-testid^="simulator-job-"]:not([data-testid*="toggle"])').first()
}

async function addTicket(page: Page, text: string) {
    await expect(async () => {
        await page.getByTestId('ticket-input').fill(text)
        await expect(page.getByTestId('ticket-add')).toBeEnabled({ timeout: 1_000 })
    }).toPass()
    await page.getByTestId('ticket-add').click()
    await expect(page.getByTestId('tickets-list')).toContainText(text)
}

test('held world: an exported job stays queued until Simulator runs it forward, then the download appears', async ({
    page,
}) => {
    // The held-flag toggle triggers a full reload (banner-style RSC re-read), and the Jobs tab lazily
    // compiles on first hit in a fresh dev server — generous room over the default.
    test.setTimeout(120_000)

    await signInAs(page, 'person-admin')

    // Flip jobs-held ON via the Snapshots tab. Its onChange full-reloads the SAME url, so a URL wait
    // resolves instantly and racing the panel teardown is flaky — stamp the old document instead, the
    // stamp vanishes exactly when the fresh document mounts (mirrors simulator-snapshots.spec.ts).
    await openSimulatorPanel(page)
    await page.getByTestId('simulator-tab-snapshots').click()
    await page.evaluate(() => {
        ;(window as unknown as { __preToggle?: boolean }).__preToggle = true
    })
    await page.getByTestId('flag-toggle-jobs-held').click()
    await page.waitForFunction(() => !(window as unknown as { __preToggle?: boolean }).__preToggle, undefined, {
        timeout: 45_000,
    })

    // Back on the (reloaded) dashboard, export the team's tickets. Held world → the job stays queued.
    await expect(page.getByTestId('tickets-card')).toBeVisible()
    await addTicket(page, `held-export-${Date.now()}`)
    await expect(page.getByTestId('export-card')).toBeVisible()
    const rows = page.getByTestId('export-job')
    const before = await rows.count()
    await page.getByTestId('export-run').click()
    await expect(rows).toHaveCount(before + 1)

    const dashJob = rows.first()
    await expect(dashJob.getByTestId('job-timeline-entry-queued')).toBeVisible()
    await expect(dashJob.getByTestId('job-timeline-entry-completed')).toHaveCount(0)
    await expect(dashJob.getByTestId('job-download')).toHaveCount(0)

    // The Simulator Jobs tab flags the paused world and lists our still-queued job.
    await openSimulatorPanel(page)
    await page.getByTestId('simulator-tab-jobs').click()
    await expect(page.getByTestId('simulator-jobs-held')).toBeVisible()
    const worldJob = firstWorldJobRow(page)
    await expect(worldJob).toBeVisible()
    await expect(worldJob).toContainText('queued')
    // Expand it — the timeline shows only the queued hop so far.
    await worldJob.locator('[data-testid^="simulator-job-toggle-"]').click()
    await expect(worldJob.getByTestId('job-timeline-entry-queued')).toBeVisible()
    await expect(worldJob.getByTestId('job-timeline-entry-completed')).toHaveCount(0)

    // Step the held world forward: the notice confirms it and the job row reaches completed.
    await page.getByTestId('simulator-jobs-run').click()
    await expect(page.getByTestId('simulator-notice')).toBeVisible()
    await expect(worldJob).toContainText('completed')
    await expect(worldJob.getByTestId('job-timeline-entry-completed')).toBeVisible()

    // And the dashboard catches up (its 3s poll was live while the job was non-terminal): the
    // completed job now offers its download link.
    await expect(dashJob.getByTestId('job-download')).toBeVisible({ timeout: 15_000 })
})
