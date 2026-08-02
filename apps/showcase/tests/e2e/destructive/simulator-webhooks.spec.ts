import { rmSync } from 'node:fs'
import path from 'node:path'
import { expect, type Locator, type Page, test } from '@playwright/test'
// The signing module is pure isomorphic TS (no node builtins, no @/adapters), so a relative import
// transpiles fine under Playwright — the e2e VERIFIES the egress signature the app produced, proving
// the template teaches both halves of the scheme end to end.
import { verifyWebhookSignature, WEBHOOK_REPLAY_TOLERANCE_MS } from 'keel/core/webhook-signing'
import { openSimulatorPanel } from '../support/simulator'

/**
 * Destructive: registers webhook endpoints, drains cross-tenant deliveries into pglite, and
 * writes the fake catch-store + failure toggle under .data — so it must not race the fullyParallel main
 * suite. It resets the world at the start and clears the webhook/simulator/mail residue afterwards.
 */
const dataRoot = path.resolve(__dirname, '../../../.data')
const residue = [path.join(dataRoot, 'webhooks'), path.join(dataRoot, 'simulator'), path.join(dataRoot, 'emails')]

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

const URL_OK = 'https://hook-ok.example.test/webhook'
const URL_FAIL = 'https://hook-fail.example.test/webhook'

async function signInAs(page: Page, personId: string) {
    await page.goto('/en/signin')
    await page.getByTestId(`person-${personId}`).click()
    await page.waitForURL('**/dashboard')
}

/** Register an endpoint via the org-admin card, returning the once-shown signing secret. */
async function registerEndpoint(page: Page, url: string): Promise<string> {
    await page.getByTestId('webhook-url').fill(url)
    // The data-testid lands on Mantine v9's hidden `role="combobox"` input (size-collapsed for a
    // non-searchable MultiSelect, so a normal click is intercepted by the pills box on top). It carries
    // `data-pointer`, so a force-click dispatches to it and opens the listbox.
    await page.getByTestId('webhook-event-kinds').click({ force: true })
    const option = page.getByRole('option', { name: 'job.status_changed' })
    await expect(option).toBeVisible()
    await option.click()
    await page.keyboard.press('Escape')
    // The selection must register before create enables (disabled while no kind is chosen).
    await expect(page.getByTestId('webhook-create')).toBeEnabled()
    // Create is disabled until a kind is selected, so a successful click also confirms the selection.
    await page.getByTestId('webhook-create').click()
    const secretEl = page.getByTestId('webhook-new-secret-value')
    await expect(secretEl).toBeVisible()
    const secret = (await secretEl.textContent())?.trim() ?? ''
    await page.getByTestId('webhook-secret-dismiss').click()
    await expect(secretEl).toBeHidden()
    return secret
}

/**
 * Reads the delivery id off a `simulator-hook-delivery-<id>` row's own `data-testid` — so a caller can
 * pin later assertions to this exact row. The seed world runs a daily and a weekly job schedule
 * (packages/seed/src/index.ts), and the clock-advance below can cross one of those windows: that spawns
 * a fresh webhook delivery for the same endpoint, and `listDeliveriesForWorld` orders newest-first, so an
 * unscoped `.first()` over "endpoint URL + status" would silently latch onto the new row instead of the
 * one under test. Scoping by id sidesteps the collision instead of assuming the seed schedule can't fire.
 */
async function deliveryIdOf(row: Locator): Promise<string> {
    const testId = await row.getAttribute('data-testid')
    const id = testId?.replace(/^simulator-hook-delivery-/, '')
    if (!id) throw new Error(`expected a simulator-hook-delivery-<id> row, got data-testid="${testId}"`)
    return id
}

test('register endpoints, deliver + sign, then fail → retry → recover', async ({ page }) => {
    test.setTimeout(120_000)

    // Dana is admin of the frontline team (tenant northwind) — her active org on sign-in.
    await signInAs(page, 'person-admin')

    // Fresh world so no stray endpoints/deliveries from earlier runs.
    const reset = await page.request.post('/api/simulator/reset')
    expect(reset.ok()).toBeTruthy()

    // --- Register two endpoints via the org-admin card; capture each once-shown secret. ---
    await page.goto('/en/org')
    await expect(page.getByTestId('webhook-endpoints-card')).toBeVisible()
    const secretOk = await registerEndpoint(page, URL_OK)
    const secretFail = await registerEndpoint(page, URL_FAIL)
    expect(secretOk).toMatch(/^whsec_/)
    expect(secretFail).toMatch(/^whsec_/)
    expect(secretOk).not.toBe(secretFail)

    // --- Open Simulator Hooks; toggle the second endpoint to fail. ---
    await openSimulatorPanel(page)
    await page.getByTestId('simulator-tab-hooks').click()
    const failEndpointRow = page.locator('[data-testid^="simulator-hook-endpoint-"]').filter({ hasText: URL_FAIL })
    await expect(failEndpointRow).toBeVisible()
    await failEndpointRow.locator('[data-testid^="simulator-hook-fail-"]').click()
    // Wait until the toggle is confirmed server-side (the button reflects the refetched failing state)
    // before triggering + draining, so the drain deterministically sees this endpoint as failing.
    await expect(failEndpointRow.locator('[data-testid^="simulator-hook-fail-"]')).toHaveText('Recover')

    // --- Trigger an event: an export job's status changes emit job.status_changed to both endpoints. ---
    const job = await page.request.post('/api/jobs', {
        headers: { 'content-type': 'application/json' },
        data: { kind: 'export-tickets' },
    })
    expect(job.ok()).toBeTruthy()

    // --- Deliver due now: the OK endpoint delivers, the FAIL endpoint fails (armed for retry). ---
    await page.getByTestId('simulator-hooks-run-due').click()

    // The OK endpoint has a DELIVERED delivery whose signature VERIFIES against its secret + body.
    const deliveredRow = page
        .locator('[data-testid^="simulator-hook-delivery-"]')
        .filter({ hasText: URL_OK })
        .filter({ hasText: 'delivered' })
        .first()
    await expect(deliveredRow).toBeVisible({ timeout: 15_000 })
    await deliveredRow.locator('[data-testid^="simulator-hook-delivery-toggle-"]').click()
    const signature = (
        await deliveredRow.locator('[data-testid^="simulator-hook-delivery-signature-"]').textContent()
    )?.trim()
    const body = (await deliveredRow.locator('[data-testid^="simulator-hook-delivery-body-"]').textContent()) ?? ''
    expect(signature).toMatch(/^t=\d+,v1=[0-9a-f]+$/)
    const verified = verifyWebhookSignature(body, signature ?? '', secretOk, {
        toleranceMs: WEBHOOK_REPLAY_TOLERANCE_MS,
    })
    expect(verified).toEqual({ ok: true })

    // The FAIL endpoint has a FAILED delivery with at least one attempt, not delivered.
    const failedRow = page
        .locator('[data-testid^="simulator-hook-delivery-"]')
        .filter({ hasText: URL_FAIL })
        .filter({ hasText: 'failed' })
        .first()
    await expect(failedRow).toBeVisible()
    await expect(failedRow.locator('[data-testid^="simulator-hook-delivery-attempts-"]')).toContainText('1')

    // Pin the rest of the test to this exact delivery (see deliveryIdOf) rather than re-filtering the
    // list, which a clock advance can grow with unrelated rows for the same endpoint.
    const failedDeliveryId = await deliveryIdOf(failedRow)
    const trackedDelivery = page.locator(`[data-testid="simulator-hook-delivery-${failedDeliveryId}"]`)

    // --- Advance the world clock past the backoff → the failing delivery is retried (attempts grow). ---
    await page.getByTestId('simulator-tab-jobs').click()
    await page.getByTestId('simulator-clock-advance-hour').click()
    await page.getByTestId('simulator-tab-hooks').click()
    await expect(
        trackedDelivery.locator(`[data-testid="simulator-hook-delivery-attempts-${failedDeliveryId}"]`),
    ).toContainText('2', { timeout: 15_000 })

    // --- Recover: toggle failure off, advance again → the delivery now succeeds (durable outcome). ---
    const recoverRow = page.locator('[data-testid^="simulator-hook-endpoint-"]').filter({ hasText: URL_FAIL })
    await recoverRow.locator('[data-testid^="simulator-hook-fail-"]').click()
    await expect(recoverRow.locator('[data-testid^="simulator-hook-fail-"]')).toHaveText('Fail')
    await page.getByTestId('simulator-tab-jobs').click()
    await page.getByTestId('simulator-clock-advance-hour').click()
    await page.getByTestId('simulator-tab-hooks').click()
    await expect(
        trackedDelivery.locator(`[data-testid="simulator-hook-delivery-status-${failedDeliveryId}"]`),
    ).toHaveText('delivered', { timeout: 15_000 })
})
