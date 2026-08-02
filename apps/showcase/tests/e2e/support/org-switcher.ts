import { expect, type Page } from '@playwright/test'

/**
 * Open the header OrgSwitcher (a Mantine Menu) and pick `slug`, hydration-safe: a click on the
 * trigger before React hydrates is swallowed silently and the menu never opens, so the item click
 * would stall for its full timeout (the CI-load flake that exhausted retries on main). Retry the
 * open until the item is actually visible, then pick it. Callers assert their own "landed" state —
 * a real org change triggers a full reload, so what appears next is page-specific.
 */
export async function pickOrg(page: Page, slug: string) {
    await expect(async () => {
        await page.getByTestId('org-switcher').click()
        await expect(page.getByTestId(`org-switcher-item-${slug}`)).toBeVisible({ timeout: 1_000 })
    }).toPass()
    await page.getByTestId(`org-switcher-item-${slug}`).click()
}
