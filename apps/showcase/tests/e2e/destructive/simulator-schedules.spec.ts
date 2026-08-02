import { rmSync } from 'node:fs'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { openSimulatorPanel } from '../support/simulator'

/**
 * Destructive: advancing the Simulator world clock mutates persisted world state (the clock offset in
 * .data/simulator/clock.json), fires a cross-tenant scheduled job into pglite, and lands a digest
 * email in the caught-mail store — so this must not race the fullyParallel main suite. It lives in the
 * `destructive` project (see playwright.config.ts), which only starts after every 'chromium' test has
 * finished. It resets the world at the start (so the seeded weekly digest's next_run_at is freshly
 * within a week — a +1w advance then deterministically crosses it) and clears the clock/mail/continuity
 * residue afterwards so the world is left at real time with no stray digest mail.
 */

const dataRoot = path.resolve(__dirname, '../../../.data')
const clockFile = path.join(dataRoot, 'simulator/clock.json')
const simulatorState = path.join(dataRoot, 'simulator/state.json')
const emailsDir = path.join(dataRoot, 'emails')

function clearResidue() {
    for (const target of [clockFile, simulatorState, emailsDir]) {
        try {
            rmSync(target, { force: true, recursive: true })
        } catch {
            // never existed / already gone — fine
        }
    }
}

test.beforeAll(clearResidue)
test.afterAll(clearResidue)

async function signInAs(page: Page, personId: string) {
    await page.goto('/en/signin')
    await page.getByTestId(`person-${personId}`).click()
    await page.waitForURL('**/dashboard')
}

test('advancing the world clock past a schedule fires its digest job and lands the email in Mail', async ({ page }) => {
    // Reset re-migrates+re-seeds pglite lazily (cold), the Jobs tab compiles on first hit, and the
    // digest fires inline — generous room over the default.
    test.setTimeout(120_000)

    // Research admin (Dana) — the seeded weekly digest is addressed to her, so her own inbox shows it.
    await signInAs(page, 'person-admin')

    // Reset the world so the seeded schedule's next_run_at is freshly computed to within a week, making
    // the +1w advance below cross it deterministically regardless of what earlier runs left behind. The
    // seed person session survives the reset (dev-secret is preserved), so we stay signed in.
    const reset = await page.request.post('/api/simulator/reset')
    expect(reset.ok()).toBeTruthy()
    await page.goto('/en/dashboard')
    await expect(page.getByTestId('tickets-card')).toBeVisible()

    // Open the Jobs tab: the world clock and the seeded digest schedule are both visible.
    await openSimulatorPanel(page)
    await page.getByTestId('simulator-tab-jobs').click()
    await expect(page.getByTestId('simulator-clock')).toBeVisible()
    await expect(page.getByTestId('simulator-schedules')).toContainText('digest-email')
    // At rest the clock reads real time (offset zero).
    await expect(page.getByTestId('simulator-clock-offset')).toBeVisible()

    // Advance the world clock a week — crosses the weekly digest's next_run_at, so the due-scan fires it.
    // (Two simulator notices then stack — "scheduled job fired" AND "new mail" — so we assert the
    // concrete, durable outcomes below rather than the transient notice, which is also strict-mode-N.)
    await page.getByTestId('simulator-clock-advance-week').click()

    // A digest-email job now shows in the cross-tenant world list, run to completion inline.
    const digestJob = page
        .locator('[data-testid^="simulator-job-"]:not([data-testid*="toggle"])')
        .filter({ hasText: 'digest-email' })
        .first()
    await expect(digestJob).toBeVisible({ timeout: 15_000 })
    await expect(digestJob).toContainText('completed')

    // And the digest email lands in the Mail tab — Dana's inbox (person scope) is the recipient.
    await page.getByTestId('simulator-tab-mail').click()
    await expect(page.getByTestId('mail-list')).toContainText('digest', { timeout: 15_000 })
})
