import { expect, test, type Page } from '@playwright/test'
import { openSimulatorPanel } from './support/simulator'
import { pickOrg } from './support/org-switcher'
import { signInAs } from './support/people'

/** Pick an org in the header OrgSwitcher (a Mantine Menu). A real change triggers a full reload. */
async function switchOrg(page: Page, slug: string) {
    await pickOrg(page, slug)
}

test('signed-out visitors to protected pages land on sign-in', async ({ page }) => {
    await page.goto('/en/dashboard')
    await expect(page).toHaveURL(/\/signin/)
    await expect(page.getByTestId('person-person-admin')).toBeVisible()
})

test('person sign-in reaches the dashboard with identity shown', async ({ page }) => {
    await signInAs(page, 'person-admin')
    await expect(page.getByTestId('signed-in-as')).toContainText('Dana Okoye')
    await expect(page.getByTestId('active-tenant')).toHaveText('Northwind Support')
})

test('assistant streams a deterministic answer through the llm port', async ({ page }) => {
    await signInAs(page, 'person-admin')
    await page.getByTestId('assistant-card').getByRole('textbox').fill('What does this scaffold do?')
    await page.getByTestId('ask-button').click()
    // The COMPOSING pass always replays its purpose's default entry (its prompt carries live ticket
    // facts, so it can never hash-match), which is what makes the streamed prose identical every run.
    await expect(page.getByTestId('assistant-answer')).toContainText('queue')
})

test("assistant's tools read the caller's own team, and their findings are cited", async ({ page }) => {
    await signInAs(page, 'person-admin')
    // Open a ticket so a KNOWN row is in the queue (execute runs live against pglite, inside withTenant).
    const subject = `scanner check ${Date.now()}`
    await page.getByTestId('ticket-input').fill(subject)
    await page.getByTestId('ticket-add').click()
    await expect(page.getByTestId('tickets-list')).toContainText(subject)
    // The recorded model calls list_my_tickets; the route executes it live and returns what it read as
    // the answer's sources. A hash-match failure would fall back to a no-tool answer and cite nothing.
    await page.getByTestId('assistant-card').getByRole('textbox').fill('What tickets are open?')
    await page.getByTestId('ask-button').click()
    await expect(page.getByTestId('assistant-sources')).toContainText(subject)
})

test('the second assistant tool runs when the question is a search', async ({ page }) => {
    await signInAs(page, 'person-admin')
    // The seeded queue already contains a scanner ticket; search_tickets is the tool the model passes
    // an argument to, so this is the path that proves model-supplied input reaches a validated query.
    await page.getByTestId('assistant-card').getByRole('textbox').fill('Has anyone reported the scanner dropping out?')
    await page.getByTestId('ask-button').click()
    await expect(page.getByTestId('assistant-sources')).toContainText('scanner')
})

test('restricted people do not see the assistant (limited-access seam)', async ({ page }) => {
    await signInAs(page, 'person-restricted')
    await expect(page.getByTestId('signed-in-as')).toBeVisible()
    await expect(page.getByTestId('assistant-card')).toHaveCount(0)
})

test('switching orgs changes the member view, and does NOT re-theme (same tenant/site)', async ({ page }) => {
    await signInAs(page, 'person-admin')
    await page.goto('/en/org')

    // Land in a known org first (leftover continuity may start Dana in either Northwind org).
    await switchOrg(page, 'frontline')
    await expect(page.getByRole('heading', { name: 'Frontline Desk' })).toBeVisible()
    // Marisol is a frontline-only member.
    await expect(page.getByTestId('member-marisol.vega@example.test')).toBeVisible()
    await expect(page.getByTestId('active-tenant')).toHaveText('Northwind Support')

    await switchOrg(page, 'platform')
    await expect(page.getByRole('heading', { name: 'Platform Team' })).toBeVisible()
    // Marisol is not in platform, so switching org drops her from the list...
    await expect(page.getByTestId('member-marisol.vega@example.test')).toHaveCount(0)
    // ...but the tenant (site) is unchanged: an org switch is within one site, no re-theme.
    await expect(page.getByTestId('active-tenant')).toHaveText('Northwind Support')
})

test('crossing tenants via Simulator People re-themes the app', async ({ page }) => {
    await signInAs(page, 'person-admin')
    const buttonStyle = () =>
        page.getByTestId('ask-button').evaluate((el) => {
            const style = getComputedStyle(el)
            return `${style.backgroundColor} ${style.borderRadius}`
        })
    const northwindStyle = await buttonStyle()

    // The product has no cross-tenant UI (tenants are ambient, separately-branded sites); crossing
    // sites is a simulated-mode Simulator capability — become a person whose home tenant is pinebrook.
    await openSimulatorPanel(page)
    await page.getByTestId('people-person-guest').click()
    await page.waitForURL('**/dashboard')
    await expect(page.getByTestId('active-tenant')).toHaveText('Pinebrook Desk')

    // per-tenant theming is live (ADR-0005): same button, different tenant — different primary
    // color AND radius, so Mantine defaults can't mask a broken seam
    expect(await buttonStyle()).not.toBe(northwindStyle)
})

test('invite flow: org page → email port → Simulator Mail tab', async ({ page }) => {
    const invitee = `invitee-${Date.now()}@example.test`
    await signInAs(page, 'person-admin')

    await page.goto('/en/org')
    await expect(page.getByTestId('member-table')).toContainText('Dana Okoye')
    await page.getByTestId('invite-email').fill(invitee)
    await page.getByTestId('invite-submit').click()
    await expect(page.getByTestId('invite-sent')).toBeVisible()

    // All-mail scope, not Dana's own inbox — the invite went to `invitee`, not to Dana.
    await openSimulatorPanel(page)
    await page.getByTestId('simulator-tab-mail').click()
    await page.getByTestId('mail-scope-all').click()

    const entry = page.getByTestId('mail-list').getByText(invitee)
    await expect(entry).toBeVisible()
    await entry.click()
    await expect(page.getByTestId('mail-body')).toBeVisible()
})

test('profile edits persist through the auth port', async ({ page }) => {
    await signInAs(page, 'person-staff')
    await page.goto('/en/profile')
    await page.getByTestId('profile-name').fill('Sam Riveraer')
    await page.getByTestId('profile-save').click()
    await expect(page.getByTestId('profile-saved')).toBeVisible()
    await page.goto('/en/dashboard')
    await expect(page.getByTestId('signed-in-as')).toContainText('Sam Riveraer')
    // restore the seed name so reruns stay stable
    await page.goto('/en/profile')
    await page.getByTestId('profile-name').fill('Sam Rivera')
    await page.getByTestId('profile-save').click()
    await expect(page.getByTestId('profile-saved')).toBeVisible()
})

test('sign out returns to the public home', async ({ page }) => {
    await signInAs(page, 'person-admin')
    await page.getByTestId('user-menu').click()
    await page.getByTestId('menu-signout').click()
    await page.waitForURL('**/en')
    await page.goto('/en/dashboard')
    await expect(page).toHaveURL(/\/signin/)
})
