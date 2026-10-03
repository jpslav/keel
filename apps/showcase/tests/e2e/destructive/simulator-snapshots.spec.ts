import { expect, test, type Page } from '@playwright/test'
import { openSimulatorPanel } from '../support/simulator'

/**
 * Destructive: this spec exercises reset/save/restore, which wipe and rewrite
 * `.data/{auth,emails,analytics,pglite,storage,simulator}` on disk (see
 * src/adapters/fake/simulator-admin.ts). That would corrupt every other spec file's assumptions
 * (seed people present, specific leftover state) if it ran interleaved with them, so it lives in
 * its own Playwright project (`destructive`, see playwright.config.ts) with
 * `dependencies: ['chromium']` — Playwright only starts this project once the whole main suite has
 * finished, never in parallel with it.
 */

async function signInAs(page: Page, personId: string) {
    await page.goto('/en/signin')
    await page.getByTestId(`person-${personId}`).click()
    await page.waitForURL('**/dashboard')
}

const ensurePanelOpen = openSimulatorPanel

async function sendInvite(page: Page, email: string) {
    await page.goto('/en/org')
    await page.getByTestId('invite-email').fill(email)
    await page.getByTestId('invite-submit').click()
    await expect(page.getByTestId('invite-sent')).toBeVisible()
}

async function openAllMail(page: Page) {
    await ensurePanelOpen(page)
    await page.getByTestId('simulator-tab-mail').click()
    await page.getByTestId('mail-scope-all').click()
}

test('snapshots: save, mutate, restore, then reset returns to the seed baseline', async ({ page }) => {
    // Three world resets/restores in one test, each closing and lazily re-migrating + re-seeding
    // pglite (first-hit cold compiles of the Snapshots routes too, in a fresh dev server) — generous
    // room over the default 30s (house pattern: e2e against `next dev` needs generous timeouts).
    test.setTimeout(120_000)

    const firstInvite = `snapshot-first-${Date.now()}@example.test`
    const secondInvite = `snapshot-second-${Date.now()}@example.test`

    await signInAs(page, 'person-admin')
    await sendInvite(page, firstInvite)

    // Save a snapshot of the world with only the first invite in it.
    await ensurePanelOpen(page)
    await page.getByTestId('simulator-tab-snapshots').click()
    await page.getByTestId('snapshot-name').fill('demo-checkpoint')
    await page.getByTestId('snapshots-save').click()
    await expect(page.getByTestId('snapshots-list')).toContainText('demo-checkpoint')

    // Mutate the world after the snapshot was taken.
    await sendInvite(page, secondInvite)
    await openAllMail(page)
    await expect(page.getByTestId('mail-list')).toContainText(secondInvite)

    // Restore: the second invite's mail disappears, the snapshot's state comes back. A full
    // reload is expected (the world underneath changed) — wait for the URL rather than racing it.
    await page.getByTestId('simulator-tab-snapshots').click()
    await page.getByTestId('snapshots-restore-demo-checkpoint').click()
    await page.waitForURL('**/en')

    await openAllMail(page)
    await expect(page.getByTestId('mail-list')).toContainText(firstInvite)
    await expect(page.getByTestId('mail-list')).not.toContainText(secondInvite)

    // Reset: back to the five-seed-person baseline, empty mail, and the app still works — the
    // seed person's session survives because the dev-secret is preserved across a reset.
    await page.getByTestId('simulator-tab-snapshots').click()
    // resetWorld's window.location.assign lands on the SAME "/en" we're already sitting on (a
    // true reload, not a URL change), so URL-based waits resolve instantly, and waiting for the
    // panel to detach races the reload: the new document mounts an identical panel, so a poll can
    // miss the teardown window entirely. Stamp the old document instead — the stamp vanishes
    // exactly when the fresh document exists, however fast the reload was.
    await page.evaluate(() => {
        ;(window as unknown as { __preReset?: boolean }).__preReset = true
    })
    await page.getByTestId('snapshots-reset').click()
    await page.getByTestId('snapshots-reset-confirm').click()
    await page.waitForFunction(() => !(window as unknown as { __preReset?: boolean }).__preReset, undefined, {
        timeout: 45_000,
    })
    await expect(page.getByTestId('dashboard-link')).toBeVisible()

    // Navigate the way a user would (a click, not a raw goto racing the reset's own in-flight
    // navigation) — pglite lazily re-migrates + re-seeds on the next escalation after a reset, so
    // give the resulting page generous room to show up.
    await page.getByTestId('dashboard-link').click()
    await page.waitForURL('**/dashboard')
    await expect(page.getByTestId('signed-in-as')).toContainText('Dana Okoye', { timeout: 20_000 })

    await ensurePanelOpen(page)
    await page.getByTestId('simulator-tab-people').click()
    await expect(page.locator('[data-testid^="people-person-"]')).toHaveCount(6)

    // The seed baseline is not an EMPTY outbox: the world ships with one message already sent (the
    // ticket-assignment notice), so "back to the seed" means exactly that message and nothing else.
    await openAllMail(page)
    await expect(page.getByTestId('mail-list').locator('[data-testid^="mail-item-"]')).toHaveCount(1)
    await expect(page.getByTestId('mail-list')).not.toContainText('reset-demo@example.test')
})

test('presets: loading one replays it on the server, signs this browser in, and reserves its name', async ({
    page,
}) => {
    // Two world resets (each lazily re-migrates + re-seeds pglite) plus the replays — same room as above.
    test.setTimeout(120_000)

    // Start signed in as someone ELSE: the preset's viewpoint, not the previous session, decides who
    // this browser is afterwards.
    await signInAs(page, 'person-staff')
    await ensurePanelOpen(page)
    await page.getByTestId('simulator-tab-snapshots').click()
    await page.getByTestId('preset-load-mid-demo').click()

    // The server replays the preset and answers the dashboard, because mid-demo signs Dana in.
    await page.waitForURL('**/en/dashboard')
    await expect(page.getByTestId('signed-in-as')).toContainText('Dana Okoye', { timeout: 20_000 })
    await expect(page.getByTestId('tickets-list')).toContainText('Refund stuck in pending for three days')
    await expect(page.getByTestId('tickets-list')).toContainText('Checkout times out for shoppers in the EU')
    // The app's own operation kind, `ticket.assign`: its server half ran the same applyTicketChanges the
    // PATCH route runs, on the ticket the refund email opened (named `refund` in the script).
    const refund = page.getByTestId('ticket-item').filter({ hasText: 'Refund stuck in pending for three days' })
    await expect(refund.getByTestId(/^ticket-assignee-/)).toHaveValue('Sam Rivera')

    await ensurePanelOpen(page)
    await page.getByTestId('simulator-tab-people').click()
    const invited = page.locator('[data-testid^="people-"]').filter({ hasText: 'jordan.ellis@example.test' })
    await expect(invited).toContainText('invited')

    // A saved snapshot may not take a preset's name: a tour naming it must mean one world on every host.
    await page.getByTestId('simulator-tab-snapshots').click()
    await page.getByTestId('snapshot-name').fill('mid-demo')
    await expect(page.getByTestId('snapshots-save')).toBeDisabled()
    await expect(page.getByTestId('snapshot-name-error')).toBeVisible()
    const refused = await page.request.post('/api/simulator/snapshots', { data: { name: 'mid-demo' } })
    expect(refused.status()).toBe(403)

    // Leave the seed baseline behind for the rest of the destructive project.
    const reset = await page.request.post('/api/simulator/reset')
    expect(reset.ok()).toBe(true)
})
