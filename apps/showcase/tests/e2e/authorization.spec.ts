import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './support/people'

/**
 * Authorization, focused on the demoable denial: a restricted member (Riley) may READ tickets
 * but not create them. The UI reflects it (disabled add + read-only hint) AND the server enforces it
 * (a forced POST that bypasses the disabled controls still 403s). Positive control: a plain member
 * (Marisol) sees the enabled affordance and can create a ticket.
 */

// Hydration-safe ticket entry (mirrors jobs-export.spec.ts): fill until the add button enables.
async function addTicket(page: Page, text: string) {
    await expect(async () => {
        await page.getByTestId('ticket-input').fill(text)
        await expect(page.getByTestId('ticket-add')).toBeEnabled({ timeout: 1_000 })
    }).toPass()
    await page.getByTestId('ticket-add').click()
    await expect(page.getByTestId('tickets-list')).toContainText(text)
}

test('a restricted member gets a read-only TicketsCard and is denied ticket-create at the server', async ({ page }) => {
    await signInAs(page, 'person-restricted')

    // Read access remains: the card renders. Create is gone: input + button disabled, hint shown.
    await expect(page.getByTestId('tickets-card')).toBeVisible()
    await expect(page.getByTestId('tickets-readonly-hint')).toBeVisible()
    await expect(page.getByTestId('ticket-input')).toBeDisabled()
    await expect(page.getByTestId('ticket-add')).toBeDisabled()

    // Bypass the disabled UI: a raw POST (carrying Riley's session cookie) must still be forbidden.
    const forced = await page.request.post('/api/tickets', { data: { subject: 'forced-by-restricted' } })
    expect(forced.status()).toBe(403)
})

test('a plain member sees the enabled TicketsCard and can create a ticket (positive control)', async ({ page }) => {
    await signInAs(page, 'person-member')

    await expect(page.getByTestId('tickets-card')).toBeVisible()
    await expect(page.getByTestId('tickets-readonly-hint')).toHaveCount(0)
    await expect(page.getByTestId('ticket-input')).toBeEnabled()

    const ticketSubject = `authz-ok-${Date.now()}`
    await addTicket(page, ticketSubject)
    await expect(page.getByTestId('tickets-list')).toContainText(ticketSubject)
})

/**
 * Staff seam: Olive is admin in the desk-ops operator org, so acting AS desk-ops activates
 * the manage-all ability. The HONEST scope here is a visible smoke proof — her dashboard works in the
 * staff org and she can act — because manage-all is an ability-layer override, not a query filter:
 * route-level row scoping (escalationForActiveOrg etc.) still applies, so there is no product surface
 * where manage-all uniquely unlocks cross-org DATA. The functional manage-all override is proved in
 * src/authz/authorize.test.ts (a staff actor authorizes an action it has no side in). Keeping staff
 * powers inside the tenant is enforced by the model itself (ADR-0004).
 */
test('the staff-org operator (Olive) works in desk-ops and can author (manage-all active)', async ({ page }) => {
    await signInAs(page, 'person-operator')

    await expect(page.getByTestId('signed-in-as')).toContainText('Olive Nakamura')
    await expect(page.getByTestId('active-tenant')).toHaveText('Northwind Support')

    // Her dashboard renders and authoring is enabled (admin + non-restricted, and manage-all on top).
    await expect(page.getByTestId('tickets-card')).toBeVisible()
    await expect(page.getByTestId('tickets-readonly-hint')).toHaveCount(0)
    await expect(page.getByTestId('ticket-input')).toBeEnabled()

    const ticketSubject = `staff-ok-${Date.now()}`
    await addTicket(page, ticketSubject)
    await expect(page.getByTestId('tickets-list')).toContainText(ticketSubject)
})
