import { expect, test } from '@playwright/test'
import { openSimulatorPanel } from '../support/simulator'
import { signInAs } from '../support/people'

/**
 * Access gates + agreements. DESTRUCTIVE: bumping an agreement version mutates shared world
 * state (the Northwind ToS row in pglite), so this lives in the post-chromium destructive project. It
 * resets the world to the seed baseline at the START (so a prior run's bump can't leave Northwind people
 * pre-blocked) and again in afterAll (so it leaves the world as it found it — v1, everyone accepted).
 *
 * The seed shape (all Northwind people pre-accept the block-all ToS v1) is what keeps every other spec
 * green: nothing is gated until an operator bumps the version here.
 */

test.afterAll(async ({ browser, baseURL }) => {
    // Undo the bump for any spec that runs after us (a version bump can only be reverted by re-seeding).
    // Reset needs no auth (mode-gated only), so a fresh context is fine. `baseURL` comes from the
    // config, so an isolated-port run resets the server it actually drove.
    const context = await browser.newContext({ baseURL })
    try {
        await context.request.post('/api/simulator/reset')
    } finally {
        await context.close()
    }
})

test('bump ToS → interstitial → accept → audit + profile; advisory banner stays non-blocking', async ({ page }) => {
    // Baseline: reset to seed (Northwind ToS v1, everyone pre-accepted). The seed person session survives
    // the reset (the dev-secret is preserved), so we stay signed in.
    await signInAs(page, 'person-admin')
    const reset = await page.request.post('/api/simulator/reset')
    expect(reset.ok()).toBeTruthy()

    // Pre-accepted ⇒ the dashboard loads with no gate.
    await page.goto('/en/dashboard')
    await expect(page.getByTestId('signed-in-as')).toBeVisible()

    // Find the Northwind ToS agreement id from the Simulator world view.
    const worldResponse = await page.request.get('/api/simulator/agreements')
    expect(worldResponse.ok()).toBeTruthy()
    const world = (await worldResponse.json()) as {
        agreements: { id: string; tenantSlug: string; kind: string }[]
    }
    const tos = world.agreements.find((a) => a.tenantSlug === 'northwind' && a.kind === 'tos')
    expect(tos).toBeTruthy()
    const tosId = tos!.id

    // Bump the version through the Snapshots tab's Agreements section (the demo control).
    await openSimulatorPanel(page)
    await page.getByTestId('simulator-tab-snapshots').click()
    await expect(page.getByTestId('simulator-agreements')).toBeVisible()
    await page.getByTestId(`agreement-bump-${tosId}`).click()
    await expect(page.getByTestId('simulator-notice')).toBeVisible()

    // The next protected navigation now shows the blocking interstitial (Dana's acceptance is stale).
    await page.goto('/en/dashboard')
    await expect(page.getByTestId('gate-interstitial')).toBeVisible()
    await expect(page.getByTestId('agreement-gate')).toBeVisible()
    // The app itself is replaced by the interstitial — no dashboard content is reachable while blocked.
    await expect(page.getByTestId('signed-in-as')).toHaveCount(0)

    // Accept → the gate clears and the dashboard returns (accept POST + reload re-evaluates gates).
    await page.getByTestId('agreement-accept').click()
    await expect(page.getByTestId('signed-in-as')).toBeVisible()
    await expect(page.getByTestId('gate-interstitial')).toHaveCount(0)

    // The acceptance is in the audit trail.
    const auditResponse = await page.request.get('/api/simulator/audit')
    expect(auditResponse.ok()).toBeTruthy()
    const audit = (await auditResponse.json()) as { audit: { action: string }[] }
    expect(audit.audit.some((event) => event.action === 'agreement.accepted')).toBeTruthy()

    // The profile lists the acceptance.
    await page.goto('/en/profile')
    await expect(page.getByTestId('acceptances-section')).toContainText('Terms of Service')

    // Advisory: a pinebrook person sees the (non-blocking) banner and can still use the app. Sign out
    // first — the signin page redirects an already-authenticated user straight past the person picker.
    await page.request.post('/api/auth/signout')
    await signInAs(page, 'person-guest')
    await page.goto('/en/dashboard')
    await expect(page.getByTestId('agreement-advisory-banner')).toBeVisible()
    await expect(page.getByTestId('signed-in-as')).toBeVisible()
})
