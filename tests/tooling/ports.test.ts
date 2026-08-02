import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { portForRoot } from '../../scripts/ports.mjs'

/**
 * Every dev server and every e2e run in this repo now gets its port from this function, so its two
 * branches are load-bearing: the main checkout must keep the ports the docs promise, and a linked
 * worktree must get its own so two agent sessions cannot silently drive each other's app
 * (docs/build-notes.md records that failure three times).
 */
const MAIN = path.join('/repos', 'keel')
const WORKTREE = path.join('/repos', 'keel', '.claude', 'worktrees', 'feature-abc123')
const OTHER_WORKTREE = path.join('/repos', 'keel', '.claude', 'worktrees', 'other-def456')

describe('portForRoot', () => {
    it('keeps the documented defaults on the main checkout, so the runbooks stay true', () => {
        expect(portForRoot(MAIN, 'showcase', {})).toBe(3000)
        expect(portForRoot(MAIN, 'starter', {})).toBe(3100)
        expect(portForRoot(MAIN, 'ladle', {})).toBe(61000)
        expect(portForRoot(MAIN, 'contractPg', {})).toBe(5439)
    })

    it('moves a linked worktree off the defaults entirely', () => {
        for (const service of ['showcase', 'starter', 'ladle', 'contractPg'] as const) {
            expect(portForRoot(WORKTREE, service, {})).not.toBe(portForRoot(MAIN, service, {}))
        }
    })

    it('is deterministic — the same checkout always gets the same port', () => {
        // Load-bearing: showcase's `test:e2e` is TWO playwright invocations, and the package script
        // that starts the server computes the port separately from the config that points at it.
        // If this were a scan or a random pick, those could disagree and the suite would hang.
        expect(portForRoot(WORKTREE, 'showcase', {})).toBe(portForRoot(WORKTREE, 'showcase', {}))
    })

    it('gives different worktrees different ports', () => {
        expect(portForRoot(WORKTREE, 'showcase', {})).not.toBe(portForRoot(OTHER_WORKTREE, 'showcase', {}))
    })

    it("pairs each worktree's two apps adjacently, so one session's pair cannot straddle another's", () => {
        expect(portForRoot(WORKTREE, 'starter', {})).toBe(portForRoot(WORKTREE, 'showcase', {}) + 1)
        expect(portForRoot(OTHER_WORKTREE, 'starter', {})).toBe(portForRoot(OTHER_WORKTREE, 'showcase', {}) + 1)
    })

    it('keeps derived app ports inside the reserved band, clear of the defaults', () => {
        for (const root of [WORKTREE, OTHER_WORKTREE]) {
            const showcase = portForRoot(root, 'showcase', {})
            expect(showcase).toBeGreaterThanOrEqual(3200)
            expect(showcase).toBeLessThan(3600)
        }
    })

    it('lets an explicit env var win, which is the one-off isolated-run escape hatch', () => {
        expect(portForRoot(MAIN, 'showcase', { SHOWCASE_PORT: '3210' })).toBe(3210)
        expect(portForRoot(WORKTREE, 'showcase', { SHOWCASE_PORT: '3210' })).toBe(3210)
    })

    it('rejects a malformed override rather than silently falling back', () => {
        // A silent fallback here would start the server on a different port than the suite targets —
        // precisely the confusing failure this module exists to prevent.
        expect(() => portForRoot(MAIN, 'showcase', { SHOWCASE_PORT: 'nope' })).toThrow(/must be a port number/)
        expect(() => portForRoot(MAIN, 'showcase', { SHOWCASE_PORT: '70000' })).toThrow(/must be a port number/)
    })

    it('rejects an unknown service name', () => {
        // @ts-expect-error -- deliberately outside the known set
        expect(() => portForRoot(MAIN, 'nope', {})).toThrow(/unknown service/)
    })
})
