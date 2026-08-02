import { expect, test, type Page } from '@playwright/test'
import { openSimulatorPanel } from './support/simulator'
import { pickOrg } from './support/org-switcher'

/**
 * The user-visible tenant-isolation proof: data created in tenant A is invisible from tenant B,
 * across a real session, through the whole stack (UI → api route → withTenant → RLS on pglite).
 *
 * Tenants are ambient, separately-branded sites with no cross-tenant product UI, so crossing sites
 * here means becoming a person whose home tenant differs — a simulated-mode Simulator People switch.
 */

/**
 * Hydration-safe ticket entry: right after a navigation/reload, filling the controlled input can
 * beat React hydration on slow runners — the DOM gets the text but state doesn't, so the add
 * button stays disabled. Retry fill-until-enabled, then click.
 */
async function addTicket(page: Page, text: string) {
    await expect(async () => {
        await page.getByTestId('ticket-input').fill(text)
        await expect(page.getByTestId('ticket-add')).toBeEnabled({ timeout: 1_000 })
    }).toPass()
    await page.getByTestId('ticket-add').click()
    await expect(page.getByTestId('tickets-list')).toContainText(text)
}

/** Switch org (team) within the same tenant via the header OrgSwitcher (a Mantine Menu). */
async function switchOrg(page: Page, slug: string) {
    await pickOrg(page, slug)
    await expect(page.getByTestId('tickets-card')).toBeVisible()
}

/** Cross to another tenant/site by becoming a person whose home tenant differs (Simulator People). */
async function switchPerson(page: Page, personId: string, expectedTenant: string) {
    await openSimulatorPanel(page)
    await page.getByTestId(`people-${personId}`).click()
    // Continuity may land the person on their remembered route (/dashboard or /org). Wait for the
    // switch's own navigation to settle first — a raw goto here races it and aborts — then use the
    // app's own nav to land on the dashboard deterministically to read tickets.
    await page.waitForURL(/\/en\/(dashboard|org)(\?.*)?$/)
    await expect(page.getByTestId('active-tenant')).toHaveText(expectedTenant)
    await page.getByTestId('nav-dashboard').click()
    await page.waitForURL('**/dashboard')
}

test('tickets written in one tenant are invisible from the other', async ({ page }) => {
    const northwindTicket = `northwind-secret-${Date.now()}`
    const pinebrookTicket = `demo-secret-${Date.now()}`

    // sign in as Dana, whose home site is Northwind
    await page.goto('/en/signin')
    await page.getByTestId('person-person-admin').click()
    await page.waitForURL('**/dashboard')
    await expect(page.getByTestId('active-tenant')).toHaveText('Northwind Support')

    // write a ticket in Northwind
    await addTicket(page, northwindTicket)

    // cross to pinebrook (become Gale, whose home site is pinebrook): the Northwind ticket must be gone
    await switchPerson(page, 'person-guest', 'Pinebrook Desk')
    await expect(page.getByTestId('tickets-card')).toBeVisible()
    await expect(page.getByTestId('tickets-card')).not.toContainText(northwindTicket)

    // write a ticket in pinebrook
    await addTicket(page, pinebrookTicket)

    // back to Northwind (become Dana again): the Northwind ticket is there, Pinebrook.s is not
    await switchPerson(page, 'person-admin', 'Northwind Support')
    await expect(page.getByTestId('tickets-list')).toContainText(northwindTicket)
    await expect(page.getByTestId('tickets-card')).not.toContainText(pinebrookTicket)
})

test('tickets are scoped to the active org — switching teams switches the tickets you see', async ({ page }) => {
    const frontlineTicket = `frontline-ticket-${Date.now()}`

    // Dana is admin of both Northwind teams; sign in and land in frontline deterministically.
    await page.goto('/en/signin')
    await page.getByTestId('person-person-admin').click()
    await page.waitForURL('**/dashboard')
    await switchOrg(page, 'frontline')

    // write a ticket in frontline
    await addTicket(page, frontlineTicket)

    // switch to platform (same tenant, different team): frontline's ticket is gone
    await switchOrg(page, 'platform')
    await expect(page.getByTestId('tickets-card')).not.toContainText(frontlineTicket)

    // back to frontline: the ticket is there again
    await switchOrg(page, 'frontline')
    await expect(page.getByTestId('tickets-list')).toContainText(frontlineTicket)
})
