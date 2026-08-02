import { expect, type Page } from '@playwright/test'

/**
 * Opens the Simulator panel without racing hydration. The pill is a client component: Next SSRs
 * it looking clickable before React attaches its onClick, and a click landing in that window is
 * silently swallowed — a CI-only failure mode (slow runners under parallel load) that burned a
 * 15-30s timeout per retry. The panel stamps `data-hydrated` from its mount effect, so a click
 * gated on that attribute is guaranteed a live handler; the toPass loop additionally covers the
 * panel already being open and any dropped frame in between.
 */
export async function openSimulatorPanel(page: Page): Promise<void> {
    const panel = page.getByTestId('simulator-panel')
    await expect(async () => {
        if (await panel.isVisible()) return
        await page.locator('[data-testid="simulator-pill"][data-hydrated]').click({ timeout: 2_000 })
        await expect(panel).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 30_000 })
}
