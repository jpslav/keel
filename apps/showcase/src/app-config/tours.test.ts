import { describe, expect, it } from 'vitest'
import en from '../../messages/en.json'
import es from '../../messages/es.json'
import { resolveWorldStart } from 'keel/core/presets'
import { presets } from './simulator'
import { tours } from './tours'

/**
 * The APP's registered tours, checked against the copy they promise. The e2e walkthrough
 * (tests/demo-static/tours.spec.ts) proves a tour still DRIVES; this proves it can still SPEAK, in both
 * locales, without waiting for a browser — and it covers the Spanish catalog, which the walkthrough
 * never renders.
 *
 * A missing key is not a crash: next-intl renders the key path itself, so a typo would ship as
 * `tours.ticketStep7` on screen in front of whoever the demo was for.
 */

type Catalog = Record<string, Record<string, string> | undefined>

function resolve(catalog: Catalog, key: string): string | undefined {
    // Tour keys are fully qualified (`namespace.key`) because the engine resolves them with the ROOT
    // translator — the same shape an app-registered Simulator flag's labelKey uses.
    const [namespace, ...rest] = key.split('.')
    return catalog[namespace]?.[rest.join('.')]
}

describe('registered tours', () => {
    it('registers the desk walkthrough with a step count worth watching', () => {
        expect(tours.map((tour) => tour.id)).toEqual(['ticket-end-to-end', 'invite-from-preset'])
        for (const tour of tours) {
            // The house pacing rule: one idea per step, 8 to 20 steps.
            expect(tour.steps.length).toBeGreaterThanOrEqual(8)
            expect(tour.steps.length).toBeLessThanOrEqual(20)
        }
    })

    it('resolves every title, summary and narration key in BOTH catalogs', () => {
        for (const tour of tours) {
            for (const key of [tour.titleKey, tour.summaryKey, ...tour.steps.map((step) => step.textKey)]) {
                expect(resolve(en as Catalog, key), `en is missing ${key}`).toBeTruthy()
                expect(resolve(es as Catalog, key), `es is missing ${key}`).toBeTruthy()
            }
        }
    })

    it('announces every step that changes the world on Next, and wires every step that says so', () => {
        // The pacing contract, checked in both directions. An `advance` script runs when the viewer
        // presses Next and is where every submission lives, so a step that has one must SAY so ("press
        // Next to send it") — a world that changes without warning is the thing that makes a
        // walkthrough feel like a video. And narration that promises an action must have one behind it.
        for (const tour of tours) {
            for (const [index, step] of tour.steps.entries()) {
                const narration = resolve(en as Catalog, step.textKey) ?? ''
                const promises = /press Next to/i.test(narration)
                const where = `${tour.id} step ${index + 1}`
                expect(step.advance !== undefined, `${where}: promises an action but has no advance`).toBe(promises)
                expect(step.advance?.length ?? 1, `${where}: empty advance`).toBeGreaterThan(0)
            }
        }
    })

    it('starts every tour from a world EVERY host can produce', () => {
        // `'reset'` or a registered demo preset — never a saved snapshot, which lives in one server's
        // `.data/` and does not exist in the `file://` demo. The static walkthrough would catch it too (a
        // start the host cannot honour is a recorded miss); this says so without building a bundle.
        for (const tour of tours) {
            if (tour.snapshot === undefined) continue
            expect(
                resolveWorldStart(tour.snapshot, presets).kind,
                `${tour.id} starts from "${tour.snapshot}"`,
            ).not.toBe('snapshot')
        }
    })
})
