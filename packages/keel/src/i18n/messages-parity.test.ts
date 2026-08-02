import { loadAppMessages } from '@app-config/messages'
import { describe, expect, it } from 'vitest'
import { mergeMessages, type MessageTree } from './messages'
import enFramework from './messages/en.json'
import esFramework from './messages/es.json'

/**
 * en/es parity over the MERGED catalog (the framework half + the app half, which arrives through the
 * ADR-0012 seam). The catalogs are physically split, but what ships to the user is the
 * merge — so that is what must stay key- and placeholder-identical. The framework half is checked on
 * its own too, so the package carries a truthful guarantee independent of whatever app consumes it.
 */

function flatten(tree: MessageTree, prefix = ''): Map<string, string> {
    const out = new Map<string, string>()
    for (const [key, value] of Object.entries(tree)) {
        const path = prefix ? `${prefix}.${key}` : key
        if (typeof value === 'string') out.set(path, value)
        else for (const [k, v] of flatten(value, path)) out.set(k, v)
    }
    return out
}

const icuArgs = (msg: string) => [...msg.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort()

function expectParity(en: MessageTree, es: MessageTree): void {
    const enFlat = flatten(en)
    const esFlat = flatten(es)
    expect([...esFlat.keys()].sort()).toEqual([...enFlat.keys()].sort())
    for (const [key, enMsg] of enFlat) {
        const esMsg = esFlat.get(key)
        if (esMsg !== undefined) expect(icuArgs(esMsg), key).toEqual(icuArgs(enMsg))
    }
}

const enApp = await loadAppMessages('en')
const esApp = await loadAppMessages('es')

describe('message catalogs: en vs es', () => {
    it('the framework catalog has identical key sets and ICU placeholders', () => {
        expectParity(enFramework, esFramework)
    })

    it('the MERGED catalog (framework + app) has identical key sets and ICU placeholders', () => {
        expectParity(mergeMessages(enFramework, enApp), mergeMessages(esFramework, esApp))
    })
})
