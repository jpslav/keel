import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { openSimulatorPanel } from './support/simulator'
import { signInAs } from './support/people'

/**
 * Full-app axe sweep (extends smoke.spec.ts, which only covers the public home page).
 * One test per route so a violation names exactly which screen regressed.
 */

const publicRoutes = ['/en', '/es', '/en/signin', '/es/signin', '/en/accept-invite', '/es/accept-invite']

for (const route of publicRoutes) {
    test(`axe: ${route} (signed out)`, async ({ page }) => {
        await page.goto(route)
        await page.waitForLoadState('networkidle')
        const results = await new AxeBuilder({ page }).analyze()
        expect(results.violations, route).toEqual([])
    })
}

// The Simulator actor pages render signed-out (they live outside the (protected) layout) and drive
// their own process loop, so sweep them PAUSED (`?paused=1`) — the append-only log then isn't
// mutating mid-scan and axe samples a settled tree. They're plain same-origin pages with no menus,
// so a full analyze like the public routes above (not the scoped popover sweep further down).
const actorRoutes = ['/en/simulator/actors/bundle-analyzer?paused=1', '/en/simulator/actors/partner-desk?paused=1']

for (const route of actorRoutes) {
    test(`axe: ${route} (paused actor)`, async ({ page }) => {
        await page.goto(route)
        await expect(page.getByTestId('actor-shell')).toBeVisible({ timeout: 30_000 })
        await page.waitForLoadState('networkidle')
        const results = await new AxeBuilder({ page }).analyze()
        expect(results.violations, route).toEqual([])
    })
}

const adminRoutes = ['/en/dashboard', '/en/org', '/en/profile', '/es/dashboard']

for (const route of adminRoutes) {
    test(`axe: ${route} (admin)`, async ({ page }) => {
        await signInAs(page, 'person-admin')
        await page.goto(route)
        await page.waitForLoadState('networkidle')
        const results = await new AxeBuilder({ page }).analyze()
        expect(results.violations, route).toEqual([])
    })
}

// The Events/Errors screens used to get swept via their /dev/* routes; they now live only inside
// the Simulator panel, and the panel's own dark skin is a surface of its own — so sweep the
// expanded panel once per tab. Pages above cover the collapsed-pill default state.
const simulatorTabs = ['people', 'mail', 'events', 'errors', 'snapshots']

for (const tab of simulatorTabs) {
    test(`axe: simulator panel, ${tab} tab (admin)`, async ({ page }) => {
        await signInAs(page, 'person-admin')
        await page.goto('/en/dashboard')
        await openSimulatorPanel(page)
        await page.getByTestId(`simulator-tab-${tab}`).click()
        await page.waitForLoadState('networkidle')
        const results = await new AxeBuilder({ page }).analyze()
        expect(results.violations, `simulator:${tab}`).toEqual([])
    })
}

// The header popovers (OrgSwitcher, UserMenu) are only in the DOM once opened, so the route sweeps
// above never see them — and the polish slice put new text in them (preview rows, role sub-lines).
// Scope this to color-contrast: an open Mantine Menu trips `region` (it portals to document.body,
// outside any landmark) and `aria-required-children` (Mantine's autofocus role="presentation" helper
// sits inside role="menu") — framework-level quirks, not our markup. Dana belongs to two orgs, so both
// the switcher and the menu render.
async function contrastViolations(page: import('@playwright/test').Page) {
    return (await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()).violations
}

test('axe: header popovers open — text contrast (admin)', async ({ page }) => {
    await signInAs(page, 'person-admin')
    await page.goto('/en/dashboard')
    // Kill transitions so axe samples the settled popover, not a mid-fade frame (semi-transparent
    // text reads as a false contrast failure).
    await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' })

    await page.getByTestId('org-switcher').click()
    await expect(page.getByTestId('org-switcher-item-platform')).toBeVisible()
    expect(await contrastViolations(page), 'org-switcher open').toEqual([])
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('org-switcher-item-platform')).toHaveCount(0)

    await page.getByTestId('user-menu').click()
    await expect(page.getByTestId('menu-signout')).toBeVisible()
    expect(await contrastViolations(page), 'user-menu open').toEqual([])
})

test('axe: /en/dashboard (restricted)', async ({ page }) => {
    await signInAs(page, 'person-restricted')
    await page.goto('/en/dashboard')
    await page.waitForLoadState('networkidle')
    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations, '/en/dashboard (restricted)').toEqual([])
})
