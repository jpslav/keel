import { describe, expect, it } from 'vitest'
import {
    expandPreset,
    isReservedWorldStartName,
    presetProblems,
    resolveWorldStart,
    type DemoPreset,
    type PresetOperation,
    type PresetWorld,
} from './presets'

// keel's own vocabulary (packages/keel/test-fixture), never an app's — see CLAUDE.md.
const WORLD: PresetWorld = {
    people: [
        {
            id: 'fixture-lead',
            email: 'ada.keeper@example.test',
            memberships: [
                { orgSlug: 'depot', role: 'admin' },
                { orgSlug: 'annex', role: 'admin' },
            ],
        },
        { id: 'fixture-crew', email: 'cy.rigger@example.test', memberships: [{ orgSlug: 'depot', role: 'member' }] },
    ],
    orgSlugs: ['depot', 'annex', 'wharf'],
    handlers: ['support'],
    flags: ['demo-banner', 'jobs-held'],
}

const BUSY: DemoPreset = {
    id: 'busy-harbor',
    titleKey: 'fixture.busyTitle',
    summaryKey: 'fixture.busySummary',
    viewpoint: 'fixture-lead',
    operations: [
        { op: 'invite', by: 'fixture-lead', org: 'depot', email: 'new.hand@example.test', role: 'member' },
        { op: 'inbound', org: 'depot', handler: 'support', from: 'cy.rigger@example.test', subject: 'S', body: 'B' },
        { op: 'flag', flag: 'jobs-held', enabled: true },
    ],
}

describe('resolveWorldStart', () => {
    it('resolves reset, then a preset, then falls through to a saved snapshot', () => {
        expect(resolveWorldStart('reset', [BUSY])).toEqual({ kind: 'reset' })
        expect(resolveWorldStart('busy-harbor', [BUSY])).toEqual({ kind: 'preset', preset: BUSY })
        expect(resolveWorldStart('my-checkpoint', [BUSY])).toEqual({ kind: 'snapshot', name: 'my-checkpoint' })
    })

    it('reserves reset and every preset id against saved snapshots', () => {
        expect(isReservedWorldStartName('reset', [])).toBe(true)
        expect(isReservedWorldStartName('busy-harbor', [BUSY])).toBe(true)
        expect(isReservedWorldStartName('my-checkpoint', [BUSY])).toBe(false)
    })
})

describe('expandPreset', () => {
    const DEPOT_INVITE: PresetOperation = {
        op: 'invite',
        by: 'fixture-lead',
        org: 'depot',
        email: 'new.hand@example.test',
        role: 'member',
    }
    const ANNEX_INVITE: PresetOperation = {
        op: 'invite',
        by: 'fixture-lead',
        org: 'annex',
        email: 'annex.hand@example.test',
        role: 'member',
    }
    const JOBS_HELD: PresetOperation = { op: 'flag', flag: 'jobs-held', enabled: true }
    const ROOT: DemoPreset = {
        id: 'root',
        titleKey: 'k',
        summaryKey: 'k',
        viewpoint: 'fixture-crew',
        operations: [DEPOT_INVITE],
    }
    const MIDDLE: DemoPreset = {
        id: 'middle',
        titleKey: 'k',
        summaryKey: 'k',
        extends: 'root',
        operations: [ANNEX_INVITE],
    }
    const LEAF: DemoPreset = { id: 'leaf', titleKey: 'k', summaryKey: 'k', extends: 'middle', operations: [JOBS_HELD] }

    it('is the preset itself when it extends nothing', () => {
        expect(expandPreset('busy-harbor', [BUSY])).toEqual({ operations: BUSY.operations, viewpoint: 'fixture-lead' })
    })

    it("replays the chain base first: the root's operations, then each descendant's, the named preset's last", () => {
        expect(expandPreset('leaf', [LEAF, MIDDLE, ROOT])?.operations).toEqual([DEPOT_INVITE, ANNEX_INVITE, JOBS_HELD])
        expect(expandPreset('middle', [LEAF, MIDDLE, ROOT])?.operations).toEqual([DEPOT_INVITE, ANNEX_INVITE])
    })

    it('treats an absent operations list as empty, and omits a viewpoint nobody in the chain names', () => {
        const bare: DemoPreset = { id: 'bare', titleKey: 'k', summaryKey: 'k' }
        expect(expandPreset('bare', [bare])).toEqual({ operations: [] })
    })

    it('inherits the nearest viewpoint toward the root, and a child that names one overrides its base', () => {
        // leaf and middle name none: the root's is inherited all the way down
        expect(expandPreset('leaf', [LEAF, MIDDLE, ROOT])?.viewpoint).toBe('fixture-crew')
        // middle names its own: it overrides the root's for itself and for everything below it
        const overriding: DemoPreset = { ...MIDDLE, viewpoint: 'fixture-lead' }
        expect(expandPreset('middle', [LEAF, overriding, ROOT])?.viewpoint).toBe('fixture-lead')
        expect(expandPreset('leaf', [LEAF, overriding, ROOT])?.viewpoint).toBe('fixture-lead')
        expect(expandPreset('root', [LEAF, overriding, ROOT])?.viewpoint).toBe('fixture-crew')
    })

    it('is null for an unknown id, an unknown base anywhere in the chain, and any cycle', () => {
        expect(expandPreset('no-such-preset', [ROOT])).toBeNull()
        expect(expandPreset('middle', [MIDDLE])).toBeNull() // base "root" is not registered
        expect(expandPreset('leaf', [LEAF, MIDDLE])).toBeNull() // ...two links down
        const a: DemoPreset = { id: 'a', titleKey: 'k', summaryKey: 'k', extends: 'b' }
        const b: DemoPreset = { id: 'b', titleKey: 'k', summaryKey: 'k', extends: 'a' }
        expect(expandPreset('a', [a, b])).toBeNull()
        expect(expandPreset('b', [a, b])).toBeNull()
        const self: DemoPreset = { id: 'self', titleKey: 'k', summaryKey: 'k', extends: 'self' }
        expect(expandPreset('self', [self])).toBeNull()
        // a preset that merely leads INTO a cycle cannot be expanded either, and the walk still terminates
        const into: DemoPreset = { id: 'into', titleKey: 'k', summaryKey: 'k', extends: 'a' }
        expect(expandPreset('into', [into, a, b])).toBeNull()
    })
})

describe('presetProblems', () => {
    it('accepts a preset made only of things the product allows', () => {
        expect(presetProblems([BUSY], WORLD)).toEqual([])
    })

    it('holds an invite to the rules the org screen enforces', () => {
        const preset: DemoPreset = {
            ...BUSY,
            operations: [
                // a member may not invite; admin is never grantable by invite
                { op: 'invite', by: 'fixture-crew', org: 'depot', email: 'x@example.test', role: 'member' },
                { op: 'invite', by: 'fixture-lead', org: 'depot', email: 'y@example.test', role: 'admin' },
                // an existing person, then the same address twice
                { op: 'invite', by: 'fixture-lead', org: 'depot', email: 'Cy.Rigger@example.test', role: 'member' },
                { op: 'invite', by: 'fixture-lead', org: 'annex', email: 'z@example.test', role: 'member' },
                { op: 'invite', by: 'fixture-lead', org: 'annex', email: 'z@example.test', role: 'member' },
                // not a member of wharf at all, and not an address
                { op: 'invite', by: 'fixture-lead', org: 'wharf', email: 'nope', role: 'member' },
            ],
        }
        const problems = presetProblems([preset], WORLD)
        expect(problems).toEqual([
            'preset "busy-harbor" operation 1 (invite): "fixture-crew" may not invite into "depot"',
            'preset "busy-harbor" operation 2 (invite): role "admin" cannot be granted by invite',
            'preset "busy-harbor" operation 3 (invite): "Cy.Rigger@example.test" is already a person or an invite',
            'preset "busy-harbor" operation 5 (invite): "z@example.test" is already a person or an invite',
            'preset "busy-harbor" operation 6 (invite): "fixture-lead" may not invite into "wharf"',
            'preset "busy-harbor" operation 6 (invite): "nope" is not an email address',
        ])
    })

    it('rejects unknown orgs, handlers, flags, viewpoints, and bad or duplicate ids', () => {
        const broken: DemoPreset = {
            id: 'reset',
            titleKey: 'k',
            summaryKey: 'k',
            viewpoint: 'nobody',
            operations: [
                {
                    op: 'inbound',
                    org: 'no-such-org',
                    handler: 'refunds',
                    from: 'nobody@example.test',
                    subject: '',
                    body: '',
                },
                { op: 'flag', flag: 'no-such-flag', enabled: true },
            ],
        }
        expect(presetProblems([broken, { ...BUSY, id: 'Bad Id' }, BUSY, BUSY], WORLD)).toEqual([
            'preset "reset": "reset" is reserved for the seeded world',
            'preset "reset": viewpoint "nobody" is not a seed person',
            'preset "reset" operation 1 (inbound): unknown org "no-such-org"',
            'preset "reset" operation 1 (inbound): no inbound handler "refunds"',
            'preset "reset" operation 1 (inbound): sender "nobody@example.test" is not a seed person',
            'preset "reset" operation 2 (flag): unknown flag "no-such-flag"',
            'preset "Bad Id": id is not a valid world-start name',
            'preset "busy-harbor": registered twice',
        ])
    })
    describe('extends', () => {
        const CHILD: DemoPreset = {
            id: 'busy-harbor-lead',
            titleKey: 'k',
            summaryKey: 'k',
            extends: 'busy-harbor',
            viewpoint: 'fixture-lead',
        }

        it('accepts a preset that adds only a viewpoint to a valid base', () => {
            expect(presetProblems([BUSY, CHILD], WORLD)).toEqual([])
        })

        it('rejects a base no preset registers, on the preset that names it', () => {
            expect(presetProblems([{ ...CHILD, extends: 'no-such-base' }], WORLD)).toEqual([
                'preset "busy-harbor-lead": extends unknown preset "no-such-base"',
            ])
        })

        it('rejects a cycle once per preset IN it, a self-reference included, without looping', () => {
            const a: DemoPreset = { id: 'a', titleKey: 'k', summaryKey: 'k', extends: 'b' }
            const b: DemoPreset = { id: 'b', titleKey: 'k', summaryKey: 'k', extends: 'a' }
            const self: DemoPreset = { id: 'self', titleKey: 'k', summaryKey: 'k', extends: 'self' }
            // `into` only leads into the a/b cycle, so it is not blamed for it
            const into: DemoPreset = { id: 'into', titleKey: 'k', summaryKey: 'k', extends: 'a' }
            expect(presetProblems([a, b, self, into], WORLD)).toEqual([
                'preset "a": extends chain has a cycle',
                'preset "b": extends chain has a cycle',
                'preset "self": extends chain has a cycle',
            ])
        })

        it('holds the EXPANDED script to the rules: an invite repeated across base and child is a duplicate', () => {
            const child: DemoPreset = {
                ...CHILD,
                operations: [
                    { op: 'invite', by: 'fixture-lead', org: 'depot', email: 'new.hand@example.test', role: 'member' },
                ],
            }
            // the base's invite is operation 1 of the expanded list, the child's own is operation 4
            expect(presetProblems([BUSY, child], WORLD)).toEqual([
                'preset "busy-harbor-lead" operation 4 (invite): "new.hand@example.test" is already a person or an invite',
            ])
        })

        it("repeats a base's own problem under each preset that extends it, and checks the expanded viewpoint", () => {
            const base: DemoPreset = {
                ...BUSY,
                viewpoint: 'nobody',
                operations: [{ op: 'flag', flag: 'no-such-flag', enabled: true }],
            }
            const inheritsBoth: DemoPreset = { id: 'inherits', titleKey: 'k', summaryKey: 'k', extends: 'busy-harbor' }
            const overridesViewpoint: DemoPreset = { ...inheritsBoth, id: 'overrides', viewpoint: 'fixture-crew' }
            expect(presetProblems([base, inheritsBoth, overridesViewpoint], WORLD)).toEqual([
                'preset "busy-harbor": viewpoint "nobody" is not a seed person',
                'preset "busy-harbor" operation 1 (flag): unknown flag "no-such-flag"',
                'preset "inherits": viewpoint "nobody" is not a seed person',
                'preset "inherits" operation 1 (flag): unknown flag "no-such-flag"',
                'preset "overrides" operation 1 (flag): unknown flag "no-such-flag"',
            ])
        })
    })
})
