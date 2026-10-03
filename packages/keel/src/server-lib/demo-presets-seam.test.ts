import { actors } from '@app-config/actors'
import { loadAppMessages } from '@app-config/messages'
import { organizations, people } from '@app-config/seed'
import { appPresetOperations, presets } from '@app-config/presets'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { makeTestTmpDir } from '../../../../tests/support/tmp-dir'
import { KNOWN_FLAGS } from '../adapters/fake/analytics'
import { composePresetOperations, expandPreset, presetProblems } from '../core/presets'
import { inboundHandlers } from '../inbound-email/handlers'
import type { MessageTree } from '../i18n/messages'

/**
 * SEAM CONFORMANCE for demo presets (keel/core/presets.ts), run under EVERY app's project as well as
 * keel's own (vitest.config.ts SEAM_CONFORMANCE_TESTS). A preset replays on two hosts that share no
 * code path, so a preset naming a person, team, handler or flag the world does not have would fail
 * differently on each — or, worse, quietly do nothing on one. This holds every registered preset to the
 * seed and the registries it will replay against, and its copy to both catalogs, at build time.
 *
 * The world is DERIVED (seed people, seed orgs, the composed inbound registry, KNOWN_FLAGS, the
 * registered actors), never
 * listed here, so the check cannot drift from what the replays actually consult. So is the operation
 * registry: keel's kinds composed with the app's (`composePresetOperations(appPresetOperations)`), and
 * held both ways to the server halves the replay dispatches to — a kind with a definition and no server
 * half would pass this file's static check and then throw on the first replay. (The STATIC halves are
 * supplied by each app's static composition root at runtime, where no unit test can see them; the static
 * demo's e2e loads every registered preset instead.)
 *
 * The static check is not the whole proof: the last case REPLAYS every registered preset through the
 * server path (keel/server-lib/demo-presets.ts) against this app's real seed, migrations and handlers,
 * so a preset that only an e2e would have caught throwing fails here, under every app. Same harness as
 * demo-presets.test.ts: a throwaway data dir, a cookie jar, a stub translator, and the fake adapters
 * standing in for the `server-only` registry.
 */
const tmp = makeTestTmpDir('app-demo-presets-seam-')
beforeAll(() => {
    process.env.APP_DATA_DIR = tmp
})
afterAll(() => {
    delete process.env.APP_DATA_DIR
})

const cookieStore = new Map<string, { value: string }>()
vi.mock('next/headers', () => ({
    cookies: async () => ({
        get: (name: string) => cookieStore.get(name),
        set: (name: string, value: string) => cookieStore.set(name, { value }),
        delete: (name: string) => cookieStore.delete(name),
    }),
}))
vi.mock('../adapters/index', async () => ({
    isSimulated: true,
    auth: (await import('../adapters/fake/auth')).fakeAuth,
    db: (await import('../adapters/fake/db')).fakeDb,
    email: (await import('../adapters/fake/email')).fakeEmail,
    analytics: (await import('../adapters/fake/analytics')).fakeAnalytics,
}))
vi.mock('next-intl/server', () => ({
    getTranslations: async () => (key: string) => key,
}))

function resolve(tree: MessageTree, key: string): unknown {
    return key.split('.').reduce<unknown>((node, part) => (node as MessageTree | undefined)?.[part], tree)
}

const definitions = composePresetOperations(appPresetOperations)

describe('registered demo presets', () => {
    it('describe only worlds the product could reach', () => {
        const problems = presetProblems(
            presets,
            {
                people: people.map((person) => ({
                    id: person.id,
                    email: person.email,
                    memberships: person.memberships,
                    restricted: person.restricted,
                })),
                orgSlugs: organizations.map((org) => org.slug),
                handlers: Object.keys(inboundHandlers),
                flags: KNOWN_FLAGS,
                actors: actors.map((actor) => actor.id),
            },
            definitions,
        )
        expect(problems).toEqual([])
    })

    it('use only operation kinds the registry defines', () => {
        const used = new Set(presets.flatMap((preset) => (preset.operations ?? []).map((operation) => operation.op)))
        expect([...used].filter((kind) => !Object.hasOwn(definitions, kind))).toEqual([])
    })

    it('have a server half for every defined operation kind, and no server half without a definition', async () => {
        const { presetOperationHandlers } = await import('./demo-presets')
        const defined = Object.keys(definitions).sort()
        expect(Object.keys(presetOperationHandlers).sort()).toEqual(defined)
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

    it('replay on the server host: every operation performed, every invite pending, every hold set, the viewpoint signed in', async () => {
        const { applyDemoPreset } = await import('./demo-presets')
        const { fakeAuth } = await import('../adapters/fake/auth')
        const { readActorHolds } = await import('../adapters/fake/simulator')
        for (const preset of presets) {
            // What replays is the EXPANDED preset (`extends` chain flattened): a child's inherited invites
            // and viewpoint are as much its world as its own.
            const expanded = expandPreset(preset.id, presets)
            if (!expanded) throw new Error(`${preset.id} does not expand (unknown base or a cycle)`)
            const result = await applyDemoPreset(preset.id, { baseUrl: 'http://localhost:3000/' })
            expect(result, preset.id).toEqual({ signedIn: expanded.viewpoint !== undefined })
            // The replay reset the world first, so the hold file is exactly the script's last word per actor.
            const expectedHolds: Record<string, boolean> = {}
            for (const operation of expanded.operations) {
                if (operation.op === 'actor.hold') expectedHolds[operation.actor] = operation.held
            }
            expect(readActorHolds(), `${preset.id}: actor holds`).toEqual(expectedHolds)
            for (const operation of expanded.operations) {
                if (operation.op !== 'invite') continue
                const members = await fakeAuth.listMembers(operation.org)
                expect(
                    members.some((member) => member.status === 'invited' && member.email === operation.email),
                    `${preset.id}: invite to ${operation.email}`,
                ).toBe(true)
            }
            if (expanded.viewpoint !== undefined) {
                expect((await fakeAuth.getCurrentUser())?.id, preset.id).toBe(expanded.viewpoint)
            }
        }
    }, 60_000)
})
