import { appPresetOperations } from '@app-config/presets'
import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import {
    composePresetOperations,
    expandPreset,
    isReservedWorldStartName,
    presetProblems,
    resolveWorldStart,
    type DemoPreset,
    type PresetOperation,
    type PresetOperationDefinition,
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
            restricted: false,
        },
        {
            id: 'fixture-crew',
            email: 'cy.rigger@example.test',
            memberships: [{ orgSlug: 'depot', role: 'member' }],
            restricted: false,
        },
    ],
    orgSlugs: ['depot', 'annex', 'wharf'],
    handlers: ['support'],
    flags: ['demo-banner', 'jobs-held'],
    actors: ['fixture-tug'],
}

// The registry the fixture's presets are checked against: keel's kinds plus the fixture's `docket.flag`.
const DEFINITIONS = composePresetOperations(appPresetOperations)

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
        expect(presetProblems([BUSY], WORLD, DEFINITIONS)).toEqual([])
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
        const problems = presetProblems([preset], WORLD, DEFINITIONS)
        expect(problems).toEqual([
            'preset "busy-harbor" operation 1 (invite): "fixture-crew" may not invite into "depot"',
            'preset "busy-harbor" operation 2 (invite): role "admin" cannot be granted by invite',
            'preset "busy-harbor" operation 3 (invite): "Cy.Rigger@example.test" is already a person or an invite',
            'preset "busy-harbor" operation 5 (invite): "z@example.test" is already a person or an invite',
            'preset "busy-harbor" operation 6 (invite): "fixture-lead" may not invite into "wharf"',
            'preset "busy-harbor" operation 6 (invite): "nope" is not an email address',
        ])
    })

    it('holds an actor.hold to the registered actors: a known id passes, an unknown one is named', () => {
        const preset = (actor: string): DemoPreset => ({
            ...BUSY,
            operations: [{ op: 'actor.hold', actor, held: true }],
        })
        expect(presetProblems([preset('fixture-tug')], WORLD, DEFINITIONS)).toEqual([])
        expect(presetProblems([preset('no-such-actor')], WORLD, DEFINITIONS)).toEqual([
            'preset "busy-harbor" operation 1 (actor.hold): unknown actor "no-such-actor"',
        ])
        // a release is as much an operation on a registered actor as a hold is
        expect(
            presetProblems(
                [{ ...BUSY, operations: [{ op: 'actor.hold', actor: 'fixture-tug', held: false }] }],
                WORLD,
                DEFINITIONS,
            ),
        ).toEqual([])
        // the shape is checked before the rule: a non-boolean `held` is a schema sentence, never "unknown actor"
        const misshapen = { op: 'actor.hold', actor: 'fixture-tug', held: 'yes' } as unknown as PresetOperation
        expect(presetProblems([{ ...BUSY, operations: [misshapen] }], WORLD, DEFINITIONS)).toEqual([
            expect.stringMatching(/^preset "busy-harbor" operation 1 \(actor\.hold\): held: \S/),
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
        expect(presetProblems([broken, { ...BUSY, id: 'Bad Id' }, BUSY, BUSY], WORLD, DEFINITIONS)).toEqual([
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
            expect(presetProblems([BUSY, CHILD], WORLD, DEFINITIONS)).toEqual([])
        })

        it('rejects a base no preset registers, on the preset that names it', () => {
            expect(presetProblems([{ ...CHILD, extends: 'no-such-base' }], WORLD, DEFINITIONS)).toEqual([
                'preset "busy-harbor-lead": extends unknown preset "no-such-base"',
            ])
        })

        it('rejects a cycle once per preset IN it, a self-reference included, without looping', () => {
            const a: DemoPreset = { id: 'a', titleKey: 'k', summaryKey: 'k', extends: 'b' }
            const b: DemoPreset = { id: 'b', titleKey: 'k', summaryKey: 'k', extends: 'a' }
            const self: DemoPreset = { id: 'self', titleKey: 'k', summaryKey: 'k', extends: 'self' }
            // `into` only leads into the a/b cycle, so it is not blamed for it
            const into: DemoPreset = { id: 'into', titleKey: 'k', summaryKey: 'k', extends: 'a' }
            expect(presetProblems([a, b, self, into], WORLD, DEFINITIONS)).toEqual([
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
            expect(presetProblems([BUSY, child], WORLD, DEFINITIONS)).toEqual([
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
            expect(presetProblems([base, inheritsBoth, overridesViewpoint], WORLD, DEFINITIONS)).toEqual([
                'preset "busy-harbor": viewpoint "nobody" is not a seed person',
                'preset "busy-harbor" operation 1 (flag): unknown flag "no-such-flag"',
                'preset "inherits": viewpoint "nobody" is not a seed person',
                'preset "inherits" operation 1 (flag): unknown flag "no-such-flag"',
                'preset "overrides" operation 1 (flag): unknown flag "no-such-flag"',
            ])
        })
    })
})

describe('presetProblems: the operation registry', () => {
    /** A preset of one script, so each case reads as "these operations, these sentences". */
    const scripted = (...operations: PresetOperation[]): DemoPreset => ({
        id: 'scripted',
        titleKey: 'k',
        summaryKey: 'k',
        operations,
    })
    /** An operation no TYPE allows — what a bad shape or an unregistered kind looks like at runtime. */
    const untyped = (operation: Record<string, unknown>) => operation as unknown as PresetOperation
    const CRANE_EMAIL: PresetOperation = {
        op: 'inbound',
        as: 'crane',
        org: 'depot',
        handler: 'support',
        from: 'cy.rigger@example.test',
        subject: 'Crane four is stuck',
        body: 'B',
    }

    it("reports one sentence per schema issue, naming its path, and skips the kind's rules until the shape passes", () => {
        const problems = presetProblems(
            [
                scripted(
                    // no email; a role that is not a role at all; and a member who may not invite, which the
                    // check would say — but the check never runs on arguments that failed the shape
                    untyped({ op: 'invite', by: 'fixture-crew', org: 'depot', role: 'captain' }),
                    untyped({ op: 'flag', flag: 'jobs-held', enabled: 'yes' }),
                ),
            ],
            WORLD,
            DEFINITIONS,
        )
        expect(problems).toEqual([
            expect.stringMatching(/^preset "scripted" operation 1 \(invite\): email: \S/),
            expect.stringMatching(/^preset "scripted" operation 1 \(invite\): role: \S/),
            expect.stringMatching(/^preset "scripted" operation 2 \(flag\): enabled: \S/),
        ])
    })

    it('refuses a kind nothing registers — an Object.prototype name included — and a schema that answers async', () => {
        const asyncFlag: PresetOperationDefinition = {
            kind: 'flag',
            args: { '~standard': { version: 1, vendor: 'test', validate: async (value) => ({ value }) } },
        }
        const problems = presetProblems(
            [
                scripted(untyped({ op: 'docket.stamp', docket: 'crane' }), untyped({ op: 'constructor' }), {
                    op: 'flag',
                    flag: 'jobs-held',
                    enabled: true,
                }),
            ],
            WORLD,
            composePresetOperations([asyncFlag]),
        )
        expect(problems).toEqual([
            'preset "scripted" operation 1 (docket.stamp): no operation kind "docket.stamp"',
            'preset "scripted" operation 2 (constructor): no operation kind "constructor"',
            'preset "scripted" operation 3 (flag): schema for kind "flag" validated asynchronously; preset schemas must be synchronous',
        ])
    })

    it("checks an app kind like keel's own: its schema, its rules, and the names it consumes", () => {
        expect(
            presetProblems(
                [scripted(CRANE_EMAIL, { op: 'docket.flag', by: 'fixture-lead', org: 'depot', docket: 'crane' })],
                WORLD,
                DEFINITIONS,
            ),
        ).toEqual([])
        // the fixture's `docket.flag` rule: the flagger is a member of the team (fixture-crew is not in annex)
        expect(
            presetProblems(
                [scripted(CRANE_EMAIL, { op: 'docket.flag', by: 'fixture-crew', org: 'annex', docket: 'crane' })],
                WORLD,
                DEFINITIONS,
            ),
        ).toEqual(['preset "scripted" operation 2 (docket.flag): "fixture-crew" is not a member of "annex"'])
    })

    it("lets an app definition with keel's kind name REPLACE keel's", () => {
        // the app's `flag` knows a rule keel's does not, and no longer knows keel's list of flags
        const harborFlag: PresetOperationDefinition<'flag', { flag: string; enabled: boolean }> = {
            kind: 'flag',
            args: v.object({ flag: v.string(), enabled: v.boolean() }),
            check: (args) => (args.flag === 'jobs-held' ? ['the harbor never holds its jobs'] : []),
        }
        const replaced = composePresetOperations([harborFlag])
        expect(replaced.flag).toBe(harborFlag)
        expect(
            presetProblems(
                [
                    scripted(
                        { op: 'flag', flag: 'jobs-held', enabled: true },
                        { op: 'flag', flag: 'no-such-flag', enabled: true },
                    ),
                ],
                WORLD,
                replaced,
            ),
        ).toEqual(['preset "scripted" operation 1 (flag): the harbor never holds its jobs'])
    })

    it('gives each `as` name to one operation only, across the expanded script', () => {
        const base = scripted(CRANE_EMAIL)
        const child: DemoPreset = {
            id: 'child',
            titleKey: 'k',
            summaryKey: 'k',
            extends: 'scripted',
            operations: [{ ...CRANE_EMAIL, subject: 'Crane five is stuck too' }],
        }
        expect(presetProblems([base, child], WORLD, DEFINITIONS)).toEqual([
            'preset "child" operation 2 (inbound): "crane" is already the name of operation 1',
        ])
    })

    it('requires every consumed name to be bound by an EARLIER operation — never bound, or bound only later', () => {
        const flagCrane: PresetOperation = { op: 'docket.flag', by: 'fixture-lead', org: 'depot', docket: 'crane' }
        expect(presetProblems([scripted(flagCrane)], WORLD, DEFINITIONS)).toEqual([
            'preset "scripted" operation 1 (docket.flag): no earlier operation is named "crane"',
        ])
        expect(presetProblems([scripted(flagCrane, CRANE_EMAIL)], WORLD, DEFINITIONS)).toEqual([
            'preset "scripted" operation 1 (docket.flag): "crane" is not named until operation 2, after this one',
        ])
    })
})
