import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { welcome } from '../catalog'

// Both locales, asserted against the catalog rather than against the product's name: renaming the
// app must never be able to break this spec (see tests/catalog.ts).
const locales = ['en', 'es']

for (const locale of locales) {
    test.describe(`home page (${locale})`, () => {
        test('renders localized content and passes axe', async ({ page }) => {
            const copy = welcome(locale)
            await page.goto(`/${locale}`)
            await expect(page.getByRole('heading', { level: 1 })).toHaveText(copy.title)
            await expect(page.getByRole('button', { name: copy.greetButton })).toBeVisible()

            const results = await new AxeBuilder({ page }).analyze()
            expect(results.violations).toEqual([])
        })
    })
}

test('greeting form round-trip', async ({ page }) => {
    const copy = welcome('en')
    await page.goto('/en')
    await page.getByLabel(copy.nameLabel).fill('  ada   lovelace ')
    await page.getByRole('button', { name: copy.greetButton }).click()
    // The whitespace/casing normalisation is the behaviour under test; the sentence around it is copy.
    await expect(page.getByTestId('greeting')).toHaveText(copy.greeting.replace('{name}', 'Ada Lovelace'))
})
