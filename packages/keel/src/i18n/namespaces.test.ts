import { APP_NAMESPACES, loadAppMessages } from '@app-config/messages'
import { describe, expect, it } from 'vitest'
import { mergeMessages } from './messages'
import enFramework from './messages/en.json'
import { FRAMEWORK_NAMESPACES } from './namespaces'

/**
 * The framework/app namespace partition (ADR-0012), and it is PHYSICAL: each side's catalog must hold
 * exactly its own namespaces, the two lists must be DISJOINT, and the merged catalog's top-level keys
 * must be exactly their union — so no namespace is orphaned or served twice. (en/es parity is covered
 * by messages-parity.test.ts.)
 */
const enApp = await loadAppMessages('en')

describe('i18n namespace partition', () => {
    const framework = [...FRAMEWORK_NAMESPACES].sort()
    const app = [...APP_NAMESPACES].sort()
    const union = [...FRAMEWORK_NAMESPACES, ...APP_NAMESPACES].sort()

    it('FRAMEWORK and APP namespaces are disjoint', () => {
        const overlap = framework.filter((ns) => (app as string[]).includes(ns))
        expect(overlap).toEqual([])
    })

    it("the framework catalog's top-level keys are exactly FRAMEWORK_NAMESPACES", () => {
        expect(Object.keys(enFramework).sort()).toEqual(framework)
    })

    it("the app catalog's top-level keys are exactly APP_NAMESPACES", () => {
        expect(Object.keys(enApp).sort()).toEqual(app)
    })

    it("the MERGED catalog's top-level keys are exactly FRAMEWORK ∪ APP", () => {
        expect(Object.keys(mergeMessages(enFramework, enApp)).sort()).toEqual(union)
    })
})
