import path from 'node:path'
import { expect, test } from '@playwright/test'
import { tours } from '../../src/app-config/tours'

/**
 * THE GATE for tours: every registered tour must run to its last step from `file://`, finding every
 * element it drives along the way.
 *
 * A tour that runs end to end IS an e2e walkthrough — it signs in, files an email into the desk,
 * assigns the ticket that email became, holds the world, watches an autonomous actor finish a job,
 * registers a webhook endpoint and accepts an escalation — so wiring it into `pnpm e2e:demo-static`
 * costs one spec and buys the thing that stops tours rotting: a screen change that breaks the
 * walkthrough fails the build instead of embarrassing someone in front of a stakeholder.
 *
 * The loop is exactly what a viewer does (press Next, read, press Next), which is deliberate: the
 * `advance` scripts where every submission lives only run on that press, so a gate that clicked
 * through some other way would not be testing the tour people actually watch.
 *
 * The verdict is the run REPORT the overlay leaves behind: `data-misses="0"`. The driver keeps a tour
 * alive through a missing element (stranding a viewer mid-story is worse than finishing awkwardly) and
 * records it instead, so "the tour finished" is not by itself proof — "the tour finished having found
 * everything" is.
 */

const indexUrl = `file://${path.resolve(__dirname, '../../dist-demo/index.html')}`

for (const tour of tours) {
    test(`tour "${tour.id}" runs to completion from file://`, async ({ page }) => {
        // Fast speed removes the reading pauses, but not the waits for the world itself (an actor
        // claiming a job takes as long as it takes), so this is minutes of narration in ~30 seconds.
        test.setTimeout(180_000)

        await page.goto(indexUrl)
        await page.getByTestId('simulator-pill').click()
        await page.getByTestId('simulator-tab-tours').click()
        await page.getByTestId('tour-fast').click()
        await page.getByTestId(`tour-start-${tour.id}`).click()

        await expect(page.getByTestId('tour-bar')).toBeVisible()
        for (let step = 1; step <= tour.steps.length; step += 1) {
            await expect(page.getByTestId('tour-progress')).toHaveAttribute('data-step', String(step))
            // Fail on the step that broke rather than only in the summary, so the failure names it.
            await expect(page.getByTestId('tour-miss')).toHaveCount(0)
            await page.getByTestId('tour-next').click()
        }

        const report = page.getByTestId('tour-report')
        await expect(report).toBeVisible()
        await expect(report).toHaveAttribute('data-misses', '0')
    })
}
