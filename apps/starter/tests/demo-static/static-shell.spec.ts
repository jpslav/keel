import path from 'node:path'
import { expect, test } from '@playwright/test'
import { welcome } from '../catalog'

const indexUrl = `file://${path.resolve(__dirname, '../../dist-demo/index.html')}`

test('the starter static shell signs in and lists an item, with the framework panel intact', async ({ page }) => {
    await page.goto(indexUrl)
    // Asserted against the catalog, not the product name — `pnpm init-app` renames the app, and this
    // spec is the first thing that would have broken if it hard-coded the title.
    await expect(page.getByRole('heading', { level: 1 })).toContainText(welcome('en').title)

    await page.getByTestId('dashboard-link').click()
    await page.getByTestId('person-person-owner').click()
    await expect(page.getByTestId('signed-in-as')).toContainText('Nadia Owner')

    await page.getByTestId('item-input').fill('write the starter')
    await page.getByTestId('item-add').click()
    await expect(page.getByTestId('items-list')).toContainText('write the starter')

    // The whole Simulator panel comes from the package: an app that registers no tabs still gets the
    // framework's, and switching people still works.
    await page.getByTestId('simulator-pill').click()
    await expect(page.getByTestId('simulator-panel')).toBeVisible()
    await page.getByTestId('people-person-teammate').click()
    await expect(page.getByTestId('signed-in-as')).toContainText('Tomás Compañero')

    // The tours off-switch: this app registers `tours: []` (src/app-config/tours.ts), so the Tours tab
    // does not exist at all — an adopter who wants no scripted walkthrough pays nothing for the one
    // the showcase ships.
    await expect(page.getByTestId('simulator-tab-tours')).toHaveCount(0)
})
