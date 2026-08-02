import { rmSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { openSimulatorPanel } from './support/simulator'
import { signInAs } from './support/people'

async function openSimulatorTab(
    page: import('@playwright/test').Page,
    tab: 'people' | 'mail' | 'events' | 'errors' | 'snapshots',
) {
    await openSimulatorPanel(page)
    await page.getByTestId(`simulator-tab-${tab}`).click()
}

// The demo-banner flag persists to .data/analytics/flags.json; make sure a toggled-on flag can't
// bleed into other suites or reruns, even if a test fails before restoring it.
test.afterAll(() => {
    try {
        rmSync(path.resolve(__dirname, '../../.data/analytics/flags.json'))
    } catch {
        // never existed / already gone — fine
    }
})

// These all sign in as the LOWEST-privilege person that still has a real account (person-member
// isn't an org manager) to prove the Simulator design invariant: gating is mode, not role. The old
// /dev/* pages 404'd for anyone who wasn't an org manager; Simulator's
// Events/Errors/Snapshots tabs — and the /api/simulator/flags + /api/simulator/error-scenario routes
// behind them — deliberately reverse that (docs/decision-log.md).

test('page views are captured through the analytics port and shown in the Simulator Events tab', async ({ page }) => {
    await signInAs(page, 'person-member')
    // generate a couple of client-side navigations, each firing the page-view beacon
    await page.getByTestId('nav-org').click()
    await page.waitForURL('**/org')
    await page.getByTestId('nav-dashboard').click()
    await page.waitForURL('**/dashboard')

    await openSimulatorTab(page, 'events')

    // the glue polls /api/simulator/events every few seconds while this tab is open; Playwright's
    // own assertion retrying covers the wait, no manual reload needed (unlike the old RSC page).
    await expect(page.getByTestId('events-list')).toContainText('page_view', { timeout: 15_000 })
})

test('the demo-banner feature flag toggles an app-wide banner via the analytics port', async ({ page }) => {
    await signInAs(page, 'person-member')
    // Flags live with the other world knobs in the Snapshots tab (see docs/decision-log.md).
    await openSimulatorTab(page, 'snapshots')
    await expect(page.getByTestId('demo-banner-flag')).toHaveCount(0)

    // toggle on — the glue POSTs to /api/simulator/flags then reloads; the layout re-reads the
    // flag. Banner-visible implies that reload has committed, so later navigations can't race it.
    await page.getByTestId('flag-toggle-demo-banner').click()
    await expect(page.getByTestId('demo-banner-flag')).toBeVisible()
    // and it's app-wide, not just on this page (a full goto avoids racing the glue's reload)
    await page.goto('/en/dashboard')
    await expect(page.getByTestId('demo-banner-flag')).toBeVisible()

    // restore: toggle off so reruns start clean
    await openSimulatorTab(page, 'snapshots')
    await page.getByTestId('flag-toggle-demo-banner').click()
    await expect(page.getByTestId('demo-banner-flag')).toHaveCount(0)
})

test('error scrubbing is provable without a DSN, client and server', async ({ page }) => {
    await signInAs(page, 'person-member')
    await openSimulatorTab(page, 'errors')

    // client-side scenario
    await page.getByTestId('throw-client-error').click()
    await expect(page.getByTestId('error-raw')).toContainText('SECRET')
    await expect(page.getByTestId('error-raw')).toContainText('user@example.com')
    await expect(page.getByTestId('error-scrubbed')).toBeVisible()
    await expect(page.getByTestId('error-scrubbed')).not.toContainText('SECRET')
    await expect(page.getByTestId('error-scrubbed')).not.toContainText('user@example.com')

    // server-side scenario (real thrown error, scrubbed on the server) — only reachable now
    // because /api/dev/error moved from an org-manager role gate to requireUser()
    await page.getByTestId('throw-server-error').click()
    await expect(page.getByTestId('error-raw')).toContainText('SECRET_COOKIE_VALUE')
    await expect(page.getByTestId('error-scrubbed')).not.toContainText('SECRET')
    await expect(page.getByTestId('error-scrubbed')).not.toContainText('user@example.com')
})

test('the retired /dev/* routes are gone', async ({ page }) => {
    await signInAs(page, 'person-admin')
    const response = await page.goto('/en/dev/events')
    expect(response?.status()).toBe(404)
})
