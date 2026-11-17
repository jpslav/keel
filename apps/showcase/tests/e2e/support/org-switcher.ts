import { expect, type Page } from '@playwright/test'

/**
 * Open the header OrgSwitcher (a Mantine Menu) and pick `slug`, hydration-safe: a click on the
 * trigger before React hydrates is swallowed silently and the menu never opens, so the item click
 * would stall for its full timeout (the CI-load flake that exhausted retries on main). Retry the
 * open until the item is actually visible, then pick it.
 *
 * Returns only once the switch has LANDED — the trigger shows the picked org's name. A real org change
 * runs a server round trip and then a full reload, and the page you are on keeps rendering, interactive
 * and un-switched, until the new document commits. On a loaded machine that is seconds, and any check the
 * old page also passes (a card that is on screen both before and after) lets the caller race straight
 * through it: a click on the dying page, or a form filled on the wrong org. The trigger's text is the
 * ACTIVE org, so it is only the picked name once the new document is there; and when the org was already
 * active the pick is a no-op with no reload, and the text already matches. The budget is one full reload
 * of a dev-mode route (the same 45s as `untilNewDocument`).
 */
export async function pickOrg(page: Page, slug: string) {
    const item = page.getByTestId(`org-switcher-item-${slug}`)
    await expect(async () => {
        await page.getByTestId('org-switcher').click()
        await expect(item).toBeVisible({ timeout: 1_000 })
    }).toPass()
    // The item's first paragraph is the org's display name (the subtitle is a div); read it before the
    // click closes the menu.
    const name = (await item.locator('p').first().innerText()).trim()
    await item.click()
    await expect(page.getByTestId('org-switcher')).toContainText(name, { timeout: 45_000 })
}
