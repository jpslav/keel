import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * This app's own message catalog, read from disk at test time.
 *
 * Specs assert against THIS rather than against a product-name literal, because the product name is
 * the one thing an adopter is guaranteed to change (`pnpm init-app`). A spec that hard-codes it
 * turns the rename into a broken gate on the adopter's first command.
 */
export function welcome(locale: string): Record<string, string> {
    const file = path.resolve(__dirname, `../messages/${locale}.json`)
    const catalog = JSON.parse(readFileSync(file, 'utf8')) as { welcome: Record<string, string> }
    return catalog.welcome
}
