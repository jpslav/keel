import type { Page } from '@playwright/test'
import { untilNewDocument } from './new-document'

export async function signInAs(page: Page, personId: string) {
    await page.goto('/en/signin')
    await page.getByTestId(`person-${personId}`).click()
    await page.waitForURL('**/dashboard')
}

/**
 * After a Simulator person switch, get onto `/dashboard` — the switch lands the person on their
 * REMEMBERED route (/dashboard, /org, /profile), so this is a no-op when that already is the dashboard
 * and one nav click when it is not.
 *
 * The click is the part to get right. The nav button is SSR'd before React attaches its handler, and a
 * click in that window is swallowed with no error — then nothing navigates, and the wait that follows
 * runs out the whole test timeout. The Simulator stamps `data-hydrated` from its mount effect (see
 * `openSimulatorPanel`) — on the pill while it is closed, on the panel while it is open, and a person switch
 * leaves it open — so once either is there the root has hydrated and the nav's handler is live: gate on
 * that, then click once. A retry loop is the wrong tool here — re-clicking restarts a navigation that is
 * merely slow, and a cold dev route can take longer than any retry interval.
 */
export async function reachDashboard(page: Page) {
    if (new URL(page.url()).pathname.endsWith('/dashboard')) return
    await page
        .locator('[data-testid="simulator-pill"][data-hydrated], [data-testid="simulator-panel"][data-hydrated]')
        .first()
        .waitFor({ state: 'attached', timeout: 30_000 })
    await untilNewDocument(page, () => page.getByTestId('nav-dashboard').click())
}
