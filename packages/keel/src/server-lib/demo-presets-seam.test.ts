import { loadAppMessages } from '@app-config/messages'
import { organizations, people } from '@app-config/seed'
import { presets } from '@app-config/simulator'
import { describe, expect, it } from 'vitest'
import { KNOWN_FLAGS } from '../adapters/fake/analytics'
import { presetProblems } from '../core/presets'
import { inboundHandlers } from '../inbound-email/handlers'
import type { MessageTree } from '../i18n/messages'

/**
 * SEAM CONFORMANCE for demo presets (keel/core/presets.ts), run under EVERY app's project as well as
 * keel's own (vitest.config.ts SEAM_CONFORMANCE_TESTS). A preset replays on two hosts that share no
 * code path, so a preset naming a person, team, handler or flag the world does not have would fail
 * differently on each — or, worse, quietly do nothing on one. This holds every registered preset to the
 * seed and the registries it will replay against, and its copy to both catalogs, at build time.
 *
 * The world is DERIVED (seed people, seed orgs, the composed inbound registry, KNOWN_FLAGS), never
 * listed here, so the check cannot drift from what the replays actually consult.
 */

function resolve(tree: MessageTree, key: string): unknown {
    return key.split('.').reduce<unknown>((node, part) => (node as MessageTree | undefined)?.[part], tree)
}

describe('registered demo presets', () => {
    it('describe only worlds the product could reach', () => {
        const problems = presetProblems(presets, {
            people: people.map((person) => ({ id: person.id, email: person.email, memberships: person.memberships })),
            orgSlugs: organizations.map((org) => org.slug),
            handlers: Object.keys(inboundHandlers),
            flags: KNOWN_FLAGS,
        })
        expect(problems).toEqual([])
    })

    it('resolve their title and summary in BOTH catalogs', async () => {
        for (const locale of ['en', 'es']) {
            const catalog = await loadAppMessages(locale)
            for (const preset of presets) {
                for (const key of [preset.titleKey, preset.summaryKey]) {
                    expect(typeof resolve(catalog, key), `${locale} is missing ${key}`).toBe('string')
                }
            }
        }
    })
})
