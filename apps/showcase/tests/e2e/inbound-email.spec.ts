import { expect, test, type Page } from '@playwright/test'
import { openSimulatorPanel } from './support/simulator'
import { pickOrg } from './support/org-switcher'
import { signInAs } from './support/people'

const DANA = 'dana.okoye@example.test' // seed admin of the `frontline` org (tenant `northwind`)

/** Fill + send the Mail tab's "compose inbound" form (the world emails the app). */
async function composeInbound(
    page: Page,
    fields: { from: string; org: string; handler: string; subject: string; body: string },
) {
    await page.getByTestId('inbound-compose-from').selectOption(fields.from)
    await page.getByTestId('inbound-compose-org').selectOption(fields.org)
    await page.getByTestId('inbound-compose-handler').fill(fields.handler)
    await page.getByTestId('inbound-compose-subject').fill(fields.subject)
    await page.getByTestId('inbound-compose-body').fill(fields.body)
    await page.getByTestId('inbound-compose-send').click()
}

test('compose inbound email → ticket appears in the queue → audit trail shows it', async ({ page }) => {
    const handledSubject = `inbound-ticket-${Date.now()}`
    const unmatchedSubject = `inbound-bogus-${Date.now()}`

    // Dana is admin of both Northwind teams; land on the frontline desk deterministically so the inbound ticket (which
    // lands there) shows on the dashboard she is looking at.
    await signInAs(page, 'person-admin')
    await pickOrg(page, 'frontline')
    await expect(page.getByTestId('tickets-card')).toBeVisible()

    await openSimulatorPanel(page)
    await page.getByTestId('simulator-tab-mail').click()

    // 1) The demo story: an email to frontline+support@… from a known member opens a ticket.
    await composeInbound(page, {
        from: DANA,
        org: 'frontline',
        handler: 'support',
        subject: handledSubject,
        body: 'two percent, please',
    })
    const handledRow = page
        .getByTestId('inbound-list')
        .locator('[data-testid^="inbound-item-"]')
        .filter({ hasText: handledSubject })
    await expect(handledRow).toContainText('handled')

    // 2) An unknown handler slug is filed 'unmatched' and is visible in the same list.
    await composeInbound(page, {
        from: DANA,
        org: 'frontline',
        handler: 'bogus',
        subject: unmatchedSubject,
        body: 'nobody handles this',
    })
    const unmatchedRow = page
        .getByTestId('inbound-list')
        .locator('[data-testid^="inbound-item-"]')
        .filter({ hasText: unmatchedSubject })
    await expect(unmatchedRow).toContainText('unmatched')

    // 3) The ticket appears in the queue (the RLS demo object). Reload to re-fetch
    //    GET /api/tickets for the active (frontline) org.
    await page.reload()
    await expect(page.getByTestId('tickets-list')).toContainText(handledSubject)
    // The bogus one created NO ticket.
    await expect(page.getByTestId('tickets-card')).not.toContainText(unmatchedSubject)

    // 4) The audit trail records both the intake and the ticket creation.
    await openSimulatorPanel(page)
    await page.getByTestId('simulator-tab-events').click()
    await expect(page.getByTestId('audit-list')).toContainText('inbound-email.received')
    await expect(page.getByTestId('audit-list')).toContainText('ticket.created')
})
