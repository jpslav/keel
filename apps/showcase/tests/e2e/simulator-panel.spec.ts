import { rmSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { openSimulatorPanel } from './support/simulator'
import { pickOrg } from './support/org-switcher'
import { signInAs } from './support/people'

function clearSimulatorState() {
    try {
        rmSync(path.resolve(__dirname, '../../.data/simulator/state.json'))
    } catch {
        // never existed / already gone — fine
    }
}

// Simulator continuity (lastPath, remembered active org) persists to a shared .data file, so a
// remembered org/route from THIS spec must not leak into other spec files, and stale lastPath values
// from earlier spec files (e.g. auth-flows.spec.ts leaving person-staff on /en/profile) must not
// make this spec's own redirect assertions flaky. Clear on both sides of the suite.
test.beforeAll(clearSimulatorState)
test.afterAll(clearSimulatorState)

test('simulator is gated by mode, not role: the lowest-privilege person still sees it', async ({ page }) => {
    // This deliberately inverts the old dev-tools assumption (manager-only): switching TO a
    // low-privilege person must never strand you, so Simulator renders for everyone.
    await signInAs(page, 'person-restricted')
    await expect(page.getByTestId('simulator-pill')).toBeVisible()

    await openSimulatorPanel(page)
    await expect(page.getByTestId('people-person-restricted')).toBeVisible()
})

test('continuity round-trip: switching people and back restores route and active org', async ({ page }) => {
    await signInAs(page, 'person-admin')

    // put Dana somewhere memorable, in a non-default org, before switching away
    await page.goto('/en/org')
    await expect(page.getByTestId('member-table')).toBeVisible()
    await pickOrg(page, 'platform')
    // the OrgScreen title is the active org's name — a direct read of "which org am I in"
    await expect(page.getByRole('heading', { name: 'Platform Team' })).toBeVisible()

    await openSimulatorPanel(page)
    await page.getByTestId('people-person-staff').click()

    // a full reload is expected (theme + header are per-user RSC output) — wait for the URL
    // rather than racing the client nav (see docs/build-tickets.md on glue-triggered reloads)
    await page.waitForURL('**/dashboard')
    await expect(page.getByTestId('signed-in-as')).toContainText('Sam Rivera')

    // the panel's own "expanded" flag is in localStorage, so it survives that reload — no need
    // to click the pill again
    await expect(page.getByTestId('simulator-panel')).toBeVisible()
    await page.getByTestId('people-person-admin').click()

    await page.waitForURL('**/org')
    await expect(page.getByTestId('member-table')).toBeVisible()
    // Dana is restored to her remembered org (platform), not reset to her first membership
    await expect(page.getByRole('heading', { name: 'Platform Team' })).toBeVisible()
})

test('signed-out: the pill still renders on the sign-in page, and picking a person signs you in', async ({ page }) => {
    await page.goto('/en/signin')
    await expect(page.getByTestId('simulator-pill')).toBeVisible()

    await openSimulatorPanel(page)
    await page.getByTestId('people-person-guest').click()

    await page.waitForURL('**/dashboard')
    await expect(page.getByTestId('signed-in-as')).toContainText('Gale Bennett')
})
