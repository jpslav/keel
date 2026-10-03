import { describe, expect, it } from 'vitest'
import {
    isReservedWorldStartName,
    presetProblems,
    resolveWorldStart,
    type DemoPreset,
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
                    from: 'a@example.test',
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
            'preset "reset" operation 2 (flag): unknown flag "no-such-flag"',
            'preset "Bad Id": id is not a valid world-start name',
            'preset "busy-harbor": registered twice',
        ])
    })
})
