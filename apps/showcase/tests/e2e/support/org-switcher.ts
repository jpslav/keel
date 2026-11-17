import { expect, type Page } from '@playwright/test'

/**
 * Open the header OrgSwitcher (a Mantine Menu) and pick `slug`, hydration-safe: a click on the
 * trigger before React hydrates is swallowed silently and the menu never opens, so the item click
 * would stall for its full timeout (the CI-load flake that exhausted retries on main). Retry the
 * open until the item is actually visible, then pick it. Every step in the loop has its own short
 * timeout, because a step that never throws (a bare click on an item whose menu just closed) blocks
 * until the test timeout and `toPass` cannot retry it; and the trigger TOGGLES the menu, so it is only
 * clicked when the item is not already showing.
 *
 * Returns only once the switch has LANDED — the trigger shows the picked org's name. A real org change
 * runs a server round trip and then a full reload, and the page you are on keeps rendering, interactive
 * and un-switched, until the new document commits. On a loaded machine that is seconds, and any check the
 * old page also passes (a card that is on screen both before and after) lets the caller race straight
 * through it: a click on the dying page, or a form filled on the wrong org. The trigger's title is the
 * ACTIVE org, so it is only the picked name once the new document is there (matched exactly: a name that
 * is part of the old one would pass early); and when the org was already active the pick is a no-op with
 * no reload, and the title already matches. The budget is one full reload of a dev-mode route (the same
 * 45s as `untilNewDocument`).
 */
export async function pickOrg(page: Page, slug: string) {
    const trigger = page.getByTestId('org-switcher')
    const item = page.getByTestId(`org-switcher-item-${slug}`)
    let name = ''
    await expect(async () => {
        if (!(await item.isVisible())) await trigger.click({ timeout: 2_000 })
        await expect(item).toBeVisible({ timeout: 1_000 })
        // The item's first paragraph is the org's display name (the subtitle is a div); read it before the
        // click closes the menu.
        name = (await item.locator('p').first().innerText({ timeout: 2_000 })).trim()
        await item.click({ timeout: 2_000 })
    }).toPass({ timeout: 45_000 })
    await expect(trigger.locator('p').first()).toHaveText(name, { timeout: 45_000 })
}
