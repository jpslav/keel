import { rmSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { openSimulatorPanel } from './support/simulator'
import { signInAs } from './support/people'

const ensurePanelOpen = openSimulatorPanel

// This spec owns Simulator continuity state AND the dynamic-people overlay — Bob's whole point
// is to become a persistent person.json entry, so both files need to start (and end) clean.
// invites.json is NOT cleared: this spec's own invite is consumed by acceptance, and other specs'
// leftover invites are harmless (each spec uses a unique invite email).
function clearFiles() {
    for (const rel of ['../../.data/simulator/state.json', '../../.data/auth/people.json']) {
        try {
            rmSync(path.resolve(__dirname, rel))
        } catch {
            // never existed / already gone — fine
        }
    }
}

test.beforeAll(clearFiles)
test.afterAll(clearFiles)

test('accept-invite: an invited person (Bob) becomes a switchable, active person', async ({ page }) => {
    const inviteEmail = `bob-${Date.now()}@example.test`

    // Dana invites Bob.
    await signInAs(page, 'person-admin')
    await page.goto('/en/org')
    await page.getByTestId('invite-email').fill(inviteEmail)
    await page.getByTestId('invite-submit').click()
    await expect(page.getByTestId('invite-sent')).toBeVisible()

    // He shows up in the People immediately, sourced live from invites.json — no account needed.
    await ensurePanelOpen(page)
    await page.getByTestId('simulator-tab-people').click()
    const invitedRow = page.locator('[data-testid^="people-"]').filter({ hasText: inviteEmail })
    await expect(invitedRow).toBeVisible()
    await expect(invitedRow).toContainText('invited')

    // Selecting him is a VIEWPOINT switch, not a sign-in: the main pane goes to the signed-out
    // welcome page (Bob has no account yet), the panel keeps following him.
    await invitedRow.click()
    await page.waitForURL('**/en')
    await expect(page.getByTestId('dashboard-link')).toBeVisible()
    await ensurePanelOpen(page)

    // His inbox (person scope, the default) shows the invite. Click the accept button INSIDE the
    // email body: the sandboxed reading pane bridges anchor clicks out via postMessage to the same
    // navigation policy as the extracted link rows (the original silent-dead-button demo trap).
    // The static-shell spec keeps covering the extracted-row path.
    await page.getByTestId('simulator-tab-mail').click()
    await expect(page.getByTestId('mail-list')).toContainText("You're invited")
    await page.getByTestId('mail-list').locator('[data-testid^="mail-item-"]').first().click()
    await expect(page.getByTestId('mail-body')).toBeVisible()
    await expect(page.getByTestId('mail-link').first()).toBeVisible()
    await page.frameLocator('[data-testid="mail-body"]').getByRole('link', { name: 'Accept invitation' }).click()

    // The accept page shows what he's accepting, then a name is all it takes.
    // Dana's active org is her first membership (frontline) after the state clear, so Bob is invited
    // into the Frontline Desk.
    await page.waitForURL('**/accept-invite**')
    await expect(page.getByRole('heading', { name: 'Join Frontline Desk' })).toBeVisible()
    await page.getByTestId('accept-name').fill('Bob Newperson')
    await page.getByTestId('accept-submit').click()

    // Accepting signs him straight in.
    await page.waitForURL('**/dashboard')
    await expect(page.getByTestId('signed-in-as')).toContainText('Bob Newperson')

    // Switching back to Dana shows Bob as an active member, not invited. (Continuity means this
    // may land her on /en/org, since that's where she was before switching away — re-navigate
    // explicitly rather than assume which target it resolves to.)
    await ensurePanelOpen(page)
    await page.getByTestId('simulator-tab-people').click()
    await page.getByTestId('people-person-admin').click()
    await page.waitForURL(/\/en\/(dashboard|org)(\?.*)?$/)

    // Navigate via the app's own nav rather than a raw goto (avoids racing the switch's own
    // pending navigation); a no-op click if continuity already landed her on /en/org.
    await page.getByTestId('nav-org').click()
    await page.waitForURL('**/org')
    // Bob is now an ACTIVE member — in the members table, not the pending-invitations table.
    const memberRow = page.getByTestId(`member-${inviteEmail}`)
    await expect(memberRow).toContainText('Bob Newperson')
    await expect(page.getByTestId(`invite-${inviteEmail}`)).toHaveCount(0)
})
