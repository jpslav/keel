import { expect, test, type Page } from '@playwright/test'
import { openSimulatorPanel } from './support/simulator'
import { pickOrg } from './support/org-switcher'
import { signInAs } from './support/people'

/**
 * Cross-org escalations, end to end. An escalation is TWO-SIDED: the org that raised it sees it under
 * "sent", the org it's addressed to sees the SAME row under "received". The requester may withdraw an
 * open escalation; the responder may accept/reject — but only an org MANAGER may respond (the demoable
 * asymmetry: a platform member sees the escalation but can't decide it, and a forced POST still 403s).
 * A bystander tenant sees nothing and a forced POST 404s. All backed by real routes + RLS on pglite.
 */

/** Switch org (team) within the same tenant via the header OrgSwitcher; the switch reloads the page. */
async function switchOrg(page: Page, slug: string) {
    await pickOrg(page, slug)
    await expect(page.getByTestId('escalations-card')).toBeVisible()
}

/**
 * Switch to another person MID-SESSION via Simulator People (a real server-side session switch in
 * simulated mode) — re-visiting /signin while already authenticated just bounces to the dashboard, so
 * this is how the tenancy suite crosses people too. Lands on the dashboard deterministically.
 */
async function switchPerson(page: Page, personId: string, expectedTenant: string) {
    await openSimulatorPanel(page)
    await page.getByTestId(`people-${personId}`).click()
    await page.waitForURL(/\/en\/(dashboard|org)(\?.*)?$/)
    await expect(page.getByTestId('active-tenant')).toHaveText(expectedTenant)
    await page.getByTestId('nav-dashboard').click()
    await page.waitForURL('**/dashboard')
    await expect(page.getByTestId('escalations-card')).toBeVisible()
}

/** Raise an escalation to `targetName`, hydration-safe (fill until the create button enables). */
async function createRequest(page: Page, targetName: string, subject: string, body: string) {
    await expect(async () => {
        await page.getByTestId('escalation-target').click()
        await page.getByRole('option', { name: targetName }).click()
        await page.getByTestId('escalation-subject').fill(subject)
        await page.getByTestId('escalation-body').fill(body)
        await expect(page.getByTestId('escalation-create')).toBeEnabled({ timeout: 1_000 })
    }).toPass()
    await page.getByTestId('escalation-create').click()
    await expect(page.getByTestId('escalations-sent-list')).toContainText(subject)
}

/** The server-side id of an escalation, found by its subject on the given side (sent|received). */
async function escalationId(page: Page, side: 'sent' | 'received', subject: string): Promise<string> {
    const data = (await page.request.get('/api/escalations').then((r) => r.json())) as {
        sent: { id: string; subject: string }[]
        received: { id: string; subject: string }[]
    }
    const found = data[side].find((r) => r.subject === subject)
    expect(found, `escalation "${subject}" on ${side}`).toBeTruthy()
    return found!.id
}

test('an escalation is two-sided: frontline sends, a platform manager accepts, requester goes read-only', async ({
    page,
}) => {
    const subject = `req-${Date.now()}`

    // Dana (admin of both Northwind teams) raises an escalation from frontline to platform.
    await signInAs(page, 'person-admin')
    await switchOrg(page, 'frontline')
    await createRequest(page, 'Platform Team', subject, 'please collaborate')

    const id = await escalationId(page, 'sent', subject)
    // Sent, Open, and withdrawable by the requester.
    await expect(page.getByTestId(`escalation-sent-${id}`)).toContainText('Open')
    await expect(page.getByTestId(`escalation-cancel-${id}`)).toBeVisible()

    // As platform (Dana is a manager there too), the SAME row appears under "received" with a decision.
    await switchOrg(page, 'platform')
    await expect(page.getByTestId(`escalation-received-${id}`)).toBeVisible()
    await expect(page.getByTestId(`escalation-accept-${id}`)).toBeVisible()
    await expect(page.getByTestId(`escalation-reject-${id}`)).toBeVisible()
    await page.getByTestId(`escalation-accept-${id}`).click()
    await expect(page.getByTestId(`escalation-received-${id}`)).toContainText('Accepted')

    // The escalation is now terminal — a second decision (forced POST) is a 409, not a silent overwrite.
    const again = await page.request.post(`/api/escalations/${id}/respond`, { data: { decision: 'accept' } })
    expect(again.status()).toBe(409)

    // Back in frontline, the requester sees it Accepted and can no longer withdraw it.
    await switchOrg(page, 'frontline')
    await expect(page.getByTestId(`escalation-sent-${id}`)).toContainText('Accepted')
    await expect(page.getByTestId(`escalation-cancel-${id}`)).toHaveCount(0)
})

test('a platform MEMBER sees the escalation read-only and is denied respond at the server', async ({ page }) => {
    const subject = `member-${Date.now()}`

    // Dana raises frontline -> platform.
    await signInAs(page, 'person-admin')
    await switchOrg(page, 'frontline')
    await createRequest(page, 'Platform Team', subject, 'body')
    const id = await escalationId(page, 'sent', subject)

    // Sam is a plain MEMBER of platform: he can read the received escalation but gets no accept/reject.
    await switchPerson(page, 'person-staff', 'Northwind Support')
    await switchOrg(page, 'platform')
    await expect(page.getByTestId(`escalation-received-${id}`)).toBeVisible()
    await expect(page.getByTestId(`escalation-accept-${id}`)).toHaveCount(0)
    await expect(page.getByTestId(`escalation-reject-${id}`)).toHaveCount(0)

    // Bypassing the missing UI: a raw respond POST (Sam's session) must still be forbidden.
    const forced = await page.request.post(`/api/escalations/${id}/respond`, { data: { decision: 'accept' } })
    expect(forced.status()).toBe(403)
})

test('a bystander tenant cannot see the escalation and a forced respond 404s', async ({ page }) => {
    const subject = `bystander-${Date.now()}`

    await signInAs(page, 'person-admin')
    await switchOrg(page, 'frontline')
    await createRequest(page, 'Platform Team', subject, 'body')
    const id = await escalationId(page, 'sent', subject)

    // Gale lives in a different tenant (pinebrook): the Northwind escalation is invisible to her.
    await switchPerson(page, 'person-guest', 'Pinebrook Desk')
    await expect(page.getByTestId('escalations-card')).not.toContainText(subject)

    // A forced respond on the Northwind escalation id is indistinguishable from a missing one (404).
    const forced = await page.request.post(`/api/escalations/${id}/respond`, { data: { decision: 'accept' } })
    expect(forced.status()).toBe(404)
})
