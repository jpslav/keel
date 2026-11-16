import { expect, test } from '@playwright/test'
import { openSimulatorPanel } from '../support/simulator'
import { signInAs } from '../support/people'
import { tours } from '../../../src/app-config/tours'

/**
 * Tours on the SERVER host. The whole walkthrough is gated from `file://`
 * (tests/demo-static/tours.spec.ts, where a tour is deterministic and costs seconds); what needs
 * proving here is the part the static twin cannot exercise, because it has no reloads:
 *
 * a tour declares a snapshot, this host restores it by wiping `.data` and RELOADING the page, and the
 * tour has to come back on the other side of that reload and carry on. Without the engine's resume
 * marker the walkthrough would die on its own first step in `pnpm dev` — the one place a stakeholder
 * is most likely to be watching over someone's shoulder.
 *
 * DESTRUCTIVE: starting the tour resets the world, hence the destructive project and the afterAll.
 */

test.afterAll(async ({ browser, baseURL }) => {
    // Leave the world as we found it for whatever runs next (reset needs no auth, mode-gated only).
    // `baseURL` comes from the config, so an isolated-port run resets the server it actually drove.
    const context = await browser.newContext({ baseURL })
    try {
        await context.request.post('/api/simulator/reset')
    } finally {
        await context.close()
    }
})

// One tour is enough to prove the host: the loop is over `tours.slice(0, 1)` so an app that registers
// none simply contributes no test here (and no Tours tab to open).
for (const tour of tours.slice(0, 1)) {
    test('the Tours tab starts a tour, and the tour survives the snapshot restore reload', async ({ page }) => {
        await signInAs(page, 'person-admin')
        await page.goto('/en/dashboard')
        await openSimulatorPanel(page)

        await page.getByTestId('simulator-tab-tours').click()
        await expect(page.getByTestId(`tour-row-${tour.id}`)).toBeVisible()

        // Preview speed: this test is about the reload, not about watching the cursor glide.
        await page.getByTestId('tour-fast').click()
        await page.getByTestId(`tour-start-${tour.id}`).click()

        // The snapshot restore reloads the whole page — proven by the URL: this test started on
        // /en/dashboard, and a reset lands on /en. The tour comes back on step 1 and keeps driving,
        // which is the resume marker doing its job rather than the tour simply never having reloaded.
        await expect(page).toHaveURL(/\/en$/, { timeout: 60_000 })
        await expect(page.getByTestId('tour-bar')).toBeVisible({ timeout: 60_000 })
        await expect(page.getByTestId('tour-progress')).toHaveAttribute('data-step', '1')
        await expect(page.getByTestId('tour-miss')).toHaveCount(0)

        // Exiting leaves a clean run report and clears the marker, so the next load is not a tour.
        await page.getByTestId('tour-exit').click()
        await expect(page.getByTestId('tour-report')).toBeVisible()
        await page.reload()
        await expect(page.getByTestId('tour-bar')).toHaveCount(0)
    })
}

// The tour that starts from a demo PRESET rather than from the seed (keel/core/presets.ts). On this host
// loading the preset is a server replay and a reload, landing on the preset's viewpoint — so this
// proves both halves at once: the world is the preset's, and the tour survived the trip.
for (const tour of tours
    .filter((candidate) => candidate.snapshot !== undefined && candidate.snapshot !== 'reset')
    .slice(0, 1)) {
    test('a tour that starts from a preset loads it on the server and resumes on the other side', async ({ page }) => {
        await signInAs(page, 'person-staff')
        await page.goto('/en/dashboard')
        await openSimulatorPanel(page)

        await page.getByTestId('simulator-tab-tours').click()
        await page.getByTestId('tour-fast').click()
        await page.getByTestId(`tour-start-${tour.id}`).click()

        // The preset's viewpoint is Dana; this test started as Sam, so the name is the proof the
        // replay — not the old session — decided who is looking.
        await expect(page.getByTestId('signed-in-as')).toContainText('Dana Okoye', { timeout: 60_000 })
        await expect(page.getByTestId('tour-bar')).toBeVisible({ timeout: 60_000 })
        await expect(page.getByTestId('tour-progress')).toHaveAttribute('data-step', '1')
        await expect(page.getByTestId('tour-miss')).toHaveCount(0)

        await page.getByTestId('tour-exit').click()
        await expect(page.getByTestId('tour-report')).toHaveAttribute('data-misses', '0')
    })
}
