import { rmSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { openSimulatorPanel } from './support/simulator'
import { signInAs } from './support/people'

function clearSimulatorState() {
    try {
        rmSync(path.resolve(__dirname, '../../.data/simulator/state.json'))
    } catch {
        // never existed / already gone — fine
    }
}

// The People row's unread chip is the last thing in its text (see people-app.tsx) — a trailing-digits
// match reads it without needing an exact absolute count. Rows without unread mail end in a chip
// label ('invited', the tenant slug, …), so the regex simply doesn't match and we report 0.
async function unreadCount(row: ReturnType<Page['locator']>): Promise<number> {
    const text = (await row.textContent()) ?? ''
    const match = /(\d+)$/.exec(text)
    return match ? Number(match[1]) : 0
}

// Simulator continuity (lastPath, remembered active tenant, mailSeenAt) persists to a shared
// .data file across spec files (see simulator-panel.spec.ts); clear on both sides so this spec's
// viewpoint switch and mailSeenAt write don't leak into — or get corrupted by — another spec.
test.beforeAll(clearSimulatorState)
test.afterAll(clearSimulatorState)

test('invite → unread badge on People → Mail tab shows it → reading it extracts a link → seen resets unread', async ({
    page,
}) => {
    // A fresh address every run: the invite API rejects duplicates (409) — inviting an existing
    // member's address is no longer a way to land mail in a seeded inbox.
    const inviteEmail = `mail-spec-${Date.now()}@example.test`
    await signInAs(page, 'person-admin')

    await openSimulatorPanel(page)
    await page.getByTestId('nav-org').click()
    await page.waitForURL('**/org')
    await page.getByTestId('invite-email').fill(inviteEmail)
    await page.getByTestId('invite-submit').click()
    await expect(page.getByTestId('invite-sent')).toBeVisible()

    // The invited person's People row carries the unread badge. The panel polls the summary every
    // few seconds while expanded, so give it a few ticks to catch up.
    await expect(page.getByTestId('simulator-panel')).toBeVisible()
    const invitedRow = page.locator('[data-testid^="people-"]').filter({ hasText: inviteEmail })
    await expect(async () => {
        expect(await unreadCount(invitedRow)).toBe(1)
    }).toPass({ timeout: 15_000 })

    // Become their viewpoint — the panel's expanded state carries through the reload (localStorage).
    await invitedRow.click()
    await page.waitForURL('**/en')
    await openSimulatorPanel(page)

    // Their Mail tab (person scope, the default) lists the invite and extracts its link.
    await page.getByTestId('simulator-tab-mail').click()
    await expect(page.getByTestId('mail-list')).toContainText("You're invited")
    await page.getByTestId('mail-list').locator('[data-testid^="mail-item-"]').first().click()
    await expect(page.getByTestId('mail-body')).toBeVisible()
    await expect(page.getByTestId('mail-link').first()).toBeVisible()

    // Opening the tab in person scope already reset the unread count to zero (design invariant) —
    // every email addressed to them up to "now" counts as seen, not just this one. Check on People.
    await page.getByTestId('simulator-tab-people').click()
    await expect(async () => {
        expect(await unreadCount(invitedRow)).toBe(0)
    }).toPass({ timeout: 15_000 })
})
