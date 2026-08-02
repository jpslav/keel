import { rmSync } from 'node:fs'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { openSimulatorPanel } from '../support/simulator'
import { pickOrg } from '../support/org-switcher'

/**
 * Notifications, end to end against real routes + RLS on pglite. Destructive because it writes
 * the SMS catch-store + caught-mail residue under .data and mutates persisted prefs — it must not race
 * the fullyParallel main suite. Serial within the file so the "mark all read → 0" step isn't perturbed
 * by the next test's emissions. People: Sam (person-staff) is frontline staff but only a platform
 * MEMBER; Dana (person-admin) is the sole platform admin — so an escalation Sam raises frontline→platform
 * notifies Dana, a clean actor≠recipient pair.
 */
test.describe.configure({ mode: 'serial' })

const dataRoot = path.resolve(__dirname, '../../../.data')
const residue = [path.join(dataRoot, 'sms'), path.join(dataRoot, 'emails'), path.join(dataRoot, 'simulator')]

function clearResidue() {
    for (const target of residue) {
        try {
            rmSync(target, { force: true, recursive: true })
        } catch {
            // never existed / already gone — fine
        }
    }
}

test.beforeAll(clearResidue)
test.afterAll(clearResidue)

async function signInAs(page: Page, personId: string) {
    await page.goto('/en/signin')
    await page.getByTestId(`person-${personId}`).click()
    await page.waitForURL('**/dashboard')
}

/**
 * Switch person mid-session via Simulator People (a real server-side session switch in simulated mode).
 *
 * The first wait accepts ANY protected route on purpose. People restores where that person last was, and
 * this file navigates Dana to /en/profile mid-test — so switching away and back legitimately lands on
 * profile, not dashboard. Pinning the wait to dashboard|org made the helper depend on whether the
 * continuity write had landed before the switch, which is a race the test has no reason to run: what it
 * actually needs to know is that the switch completed on a signed-in page, and the nav click below is
 * what gets it to the dashboard.
 */
async function switchPerson(page: Page, personId: string) {
    await openSimulatorPanel(page)
    await page.getByTestId(`people-${personId}`).click()
    await page.waitForURL(/\/en\/(dashboard|org|profile)(\?.*)?$/)
    await page.getByTestId('nav-dashboard').click()
    await page.waitForURL('**/dashboard')
    await expect(page.getByTestId('escalations-card')).toBeVisible()
}

/** Raise an escalation frontline→`targetName`, hydration-safe (fill until the create button enables). */
async function createRequest(page: Page, targetName: string, subject: string) {
    await expect(async () => {
        await page.getByTestId('escalation-target').click()
        await page.getByRole('option', { name: targetName }).click()
        await page.getByTestId('escalation-subject').fill(subject)
        await page.getByTestId('escalation-body').fill('please collaborate')
        await expect(page.getByTestId('escalation-create')).toBeEnabled({ timeout: 1_000 })
    }).toPass()
    await page.getByTestId('escalation-create').click()
    await expect(page.getByTestId('escalations-sent-list')).toContainText(subject)
}

/** The recipient's notifications as the API returns them (recipient-scoped to the session user). */
async function fetchNotifications(page: Page): Promise<{
    items: { id: string; kind: string; payload: { subject?: string }; readAt: string | null }[]
    unread: number
}> {
    return page.request.get('/api/notifications').then((r) => r.json())
}

/** Open the header bell (a Mantine Menu), hydration-safe — the click marks all read on open. */
async function openBell(page: Page) {
    await expect(async () => {
        await page.getByTestId('notification-bell').click()
        await expect(page.getByTestId('notification-item').first()).toBeVisible({ timeout: 1_000 })
    }).toPass()
}

test('a cross-team escalation raises the target admin bell, and opening it marks read', async ({ page }) => {
    const subject = `notif-${Date.now()}`

    // Sam (frontline staff, platform member) raises frontline → platform. Dana is the platform admin.
    await signInAs(page, 'person-staff')
    await pickOrg(page, 'frontline')
    await expect(page.getByTestId('escalations-card')).toBeVisible()
    await createRequest(page, 'Platform Team', subject)

    // As Dana, the notification is present and UNREAD (the durable in_app record, recipient-scoped).
    await switchPerson(page, 'person-admin')
    await expect(async () => {
        const { items } = await fetchNotifications(page)
        const found = items.find((n) => n.kind === 'escalation.received' && n.payload.subject === subject)
        expect(found, 'the escalation.received notification for Dana').toBeTruthy()
        expect(found!.readAt, 'unread on arrival').toBeNull()
    }).toPass()

    // The bell shows an unread badge; opening the popover shows the item and marks all read.
    await expect(page.getByTestId('notification-unread-count')).toBeVisible()
    await openBell(page)
    await expect(page.getByTestId('notification-item').filter({ hasText: subject })).toBeVisible()

    // Durable proof the mark-read persisted: that notification now carries a readAt, and the badge clears.
    await expect(async () => {
        const { items } = await fetchNotifications(page)
        const found = items.find((n) => n.payload.subject === subject)
        expect(found!.readAt, 'read after opening the bell').not.toBeNull()
    }).toPass()
    await expect(page.getByTestId('notification-unread-count')).toHaveCount(0)
})

test('disabling the email channel for a kind suppresses the email but keeps the in-app notification', async ({
    page,
}) => {
    const subject = `prefs-${Date.now()}`

    // Dana disables the EMAIL channel for escalation.received, in the PLATFORM team (prefs are
    // org-scoped, and the fan-out reads prefs by the notification's org — platform here). Switch the
    // active org via the API (race-free) rather than the UI switcher, which reloads and would abort the
    // immediately-following goto.
    await signInAs(page, 'person-admin')
    const switched = await page.request.post('/api/auth/org', { data: { orgSlug: 'platform' } })
    expect(switched.ok()).toBeTruthy()
    await page.goto('/en/profile')
    await expect(page.getByTestId('notification-prefs')).toBeVisible()
    // Disable the email channel for this kind through the SAME route the toggle POSTs to — driving
    // Mantine's visually-hidden Switch input reliably from Playwright is its own flaky fight (see the
    // webhook-card ticket), and the click→POST glue is already covered by the in-memory static-demo twin;
    // here we verify the route + the UI READ path. Idempotent (upsert), so a stale disabled row from a
    // prior run — prefs persist in pglite, which residue-clearing can't wipe — is fine.
    const disableResp = await page.request.post('/api/notification-prefs', {
        data: { kind: 'escalation.received', channel: 'email', enabled: false },
    })
    expect(disableResp.ok()).toBeTruthy()
    expect(await isEmailDisabled(page)).toBe(true)
    // The profile grid reflects the stored opt-out after a reload (the UI read path). Mantine puts the
    // data-testid on the Switch's checkbox input itself, so the testid IS the checkbox.
    await page.reload()
    await expect(page.getByTestId('notification-prefs')).toBeVisible()
    await expect(page.getByTestId('pref-escalation.received-email')).not.toBeChecked()

    // Count Dana's caught emails before the trigger (robust to accumulation across the suite).
    const adaEmailsBefore = await countAdaNotificationEmails(page)

    // Sam raises another frontline → platform escalation.
    await switchPerson(page, 'person-staff')
    await pickOrg(page, 'frontline')
    await createRequest(page, 'Platform Team', subject)

    // Back as Dana: the in_app notification arrived (email being off doesn't lose it) ...
    await switchPerson(page, 'person-admin')
    await expect(async () => {
        const { items } = await fetchNotifications(page)
        expect(items.some((n) => n.payload.subject === subject)).toBe(true)
    }).toPass()

    // ... but NO new notification email was caught for Dana (the email channel was suppressed).
    const adaEmailsAfter = await countAdaNotificationEmails(page)
    expect(adaEmailsAfter).toBe(adaEmailsBefore)
})

test('a kind with SMS enabled lands a message in the Simulator Messages tab', async ({ page }) => {
    const subject = `sms-${Date.now()}`

    // SMS is on by default; Sam raises frontline → platform, notifying Dana over the SMS channel.
    await signInAs(page, 'person-staff')
    await pickOrg(page, 'frontline')
    await createRequest(page, 'Platform Team', subject)

    // The fake SMS channel caught it — visible in the Simulator Messages tab (addressed to Dana Okoye).
    await openSimulatorPanel(page)
    await page.getByTestId('simulator-tab-messages').click()
    await expect(page.getByTestId('simulator-messages')).toBeVisible()
    await expect(page.getByTestId('messages-list')).toContainText('Dana Okoye')
    await expect(page.getByTestId('messages-list')).toContainText(subject)
})

/** Whether Dana's stored prefs currently disable the email channel for escalation.received. */
async function isEmailDisabled(page: Page): Promise<boolean> {
    const { prefs } = (await page.request.get('/api/notification-prefs').then((r) => r.json())) as {
        prefs: { kind: string; channel: string; enabled: boolean }[]
    }
    return prefs.some((p) => p.kind === 'escalation.received' && p.channel === 'email' && p.enabled === false)
}

/** How many notification emails (subject: "New escalation from ...") are caught for Dana right now. */
async function countAdaNotificationEmails(page: Page): Promise<number> {
    const data = (await page.request.get('/api/simulator/mail?all=1').then((r) => r.json())) as {
        emails: { to: string; subject: string }[]
    }
    return data.emails.filter((e) => e.to === 'dana.okoye@example.test' && /escalation/i.test(e.subject)).length
}
