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

/** A Simulator notice from the FRAMEWORK's catalog (keel owns the panel's copy), with its one `{name}`
 *  placeholder filled — so a spec can match the whole notice rather than a fragment two notices share. */
export function simulatorNotice(locale: string, key: string, name: string): string {
    const file = path.resolve(__dirname, `../../../packages/keel/src/i18n/messages/${locale}.json`)
    const catalog = JSON.parse(readFileSync(file, 'utf8')) as { simulator: Record<string, string> }
    const template = catalog.simulator[key]
    if (typeof template !== 'string') throw new Error(`keel's ${locale} catalog has no simulator.${key}`)
    return template.replace('{name}', name)
}

/** A fully-qualified key (`namespace.key`, as a preset's or tour's `titleKey` names it) resolved in this
 *  app's catalog — so a spec can find the copy a registration points at without restating it. */
export function appMessage(locale: string, key: string): string {
    const file = path.resolve(__dirname, `../messages/${locale}.json`)
    const catalog = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    const value = key
        .split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalog)
    if (typeof value !== 'string') throw new Error(`the ${locale} catalog has no string at ${key}`)
    return value
}
