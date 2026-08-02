import { expect, test, type Page } from '@playwright/test'

/**
 * The starter's whole e2e budget, spent on the one claim the template exists to make: an item written
 * in one tenant is invisible from the other, through the entire stack (UI → route → withTenant → RLS
 * on pglite).
 *
 * This app has no Simulator panel, so crossing tenants is done the way a real user would — sign out,
 * sign in as somebody whose home tenant differs.
 */

async function signInAs(page: Page, personId: string) {
    await page.goto('/en/signin')
    await page.getByTestId(`person-${personId}`).click()
    await page.waitForURL('**/dashboard')
}

async function signOut(page: Page) {
    await page.getByTestId('user-menu').click()
    await page.getByTestId('menu-signout').click()
    await page.waitForURL(/\/en\/?$/)
}

/** Hydration-safe entry: right after a navigation, filling the controlled input can beat React
 *  hydration, so the DOM has the text but state does not and the button stays disabled. */
async function addItem(page: Page, title: string) {
    await expect(async () => {
        await page.getByTestId('item-input').fill(title)
        await expect(page.getByTestId('item-add')).toBeEnabled({ timeout: 1_000 })
    }).toPass()
    await page.getByTestId('item-add').click()
    await expect(page.getByTestId('items-list')).toContainText(title)
}

test('an item created in one tenant is invisible from the other', async ({ page }) => {
    const secret = `northwind-item-${Date.now()}`

    // Nadia's home tenant is northwind.
    await signInAs(page, 'person-owner')
    await expect(page.getByTestId('active-tenant')).toHaveText('Northwind')
    await addItem(page, secret)

    // Reload proves the row survived a round trip through Postgres rather than living in React state.
    await page.reload()
    await expect(page.getByTestId('items-list')).toContainText(secret)

    // Cross to the other tenant: Wes must not see it, and his own view starts empty.
    await signOut(page)
    await signInAs(page, 'person-other-tenant')
    await expect(page.getByTestId('active-tenant')).toHaveText('Westgate')
    await expect(page.getByTestId('items-card')).toBeVisible()
    await expect(page.getByTestId('items-card')).not.toContainText(secret)

    // ...and back again: Nadia's item is still there.
    await signOut(page)
    await signInAs(page, 'person-owner')
    await expect(page.getByTestId('items-list')).toContainText(secret)
})
