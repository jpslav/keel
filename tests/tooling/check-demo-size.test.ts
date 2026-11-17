import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { makeTestTmpDir } from '../support/tmp-dir'

/**
 * scripts/check-demo-size.mjs is the gate on the single-file demo's size, run from each app's own directory.
 * It has three outcomes and each is pinned here: pass quietly, pass with a warning when the headroom is
 * thin (the cue the future-task used to ask a person to notice by measuring), and fail.
 */
const SCRIPT = fileURLToPath(new URL('../../scripts/check-demo-size.mjs', import.meta.url))

/** An app directory whose built demo is exactly `bytes` long, checked against `budget` (none: the script is run bare). */
function run(bytes: number, budget?: string, env: Record<string, string> = {}) {
    const app = makeTestTmpDir('keel-demo-size-')
    mkdirSync(path.join(app, 'dist-demo'))
    writeFileSync(path.join(app, 'dist-demo', 'index.html'), 'x'.repeat(bytes))
    const result = spawnSync(process.execPath, [SCRIPT, ...(budget === undefined ? [] : [budget])], {
        cwd: app,
        encoding: 'utf8',
        // a clean environment: GITHUB_ACTIONS must be absent unless the test sets it. (The cast is for Next's
        // augmentation, which makes NODE_ENV a required key of ProcessEnv.)
        env: { PATH: process.env.PATH ?? '', ...env } as unknown as NodeJS.ProcessEnv,
    })
    return { status: result.status, out: result.stdout, err: result.stderr }
}

describe('check-demo-size', () => {
    it('passes with room to spare, says how much, and stays quiet', () => {
        const { status, out, err } = run(500, '1000')
        expect(status).toBe(0)
        expect(out).toContain('500 / 1000 bytes — OK (500 bytes, 50.0% headroom)')
        expect(err).toBe('')
    })

    it('passes exactly at the budget, because only MORE than the budget fails, and warns', () => {
        const { status, out, err } = run(1000, '1000')
        expect(status).toBe(0)
        expect(out).toContain('1000 / 1000 bytes — OK (0 bytes, 0.0% headroom)')
        expect(err).toContain('only 0 bytes (0.0%) of headroom left')
    })

    it('rounds the percentage down, so the warning never sits beside the threshold it is under', () => {
        // 19.6 bytes of every 1000 is 1.96%: it warns, and must not print "2.0%"
        expect(run(9804, '10000').err).toContain('only 196 bytes (1.9%) of headroom left')
        expect(run(9804, '10000').out).toContain('(196 bytes, 1.9% headroom)')
    })

    it('warns under 2% headroom and not at 2% or over', () => {
        expect(run(981, '1000').err).toContain('only 19 bytes (1.9%) of headroom left')
        expect(run(980, '1000').err).toBe('')
    })

    it("emits a workflow annotation for the warning only on GitHub Actions, so a local run's output stays plain", () => {
        expect(run(990, '1000').out).not.toContain('::warning')
        const onCi = run(990, '1000', { GITHUB_ACTIONS: 'true' })
        expect(onCi.status).toBe(0)
        expect(onCi.out).toContain('::warning title=demo size headroom::only 10 bytes (1.0%) of headroom left')
    })

    it('fails over the budget, saying by how much and whose number it is', () => {
        const { status, err } = run(1001, '1000')
        expect(status).toBe(1)
        expect(err).toContain('1 over the 1000 byte budget')
        expect(err).toContain("this app's own")
        expect(err).toContain('WHEN IT GOES RED')
    })

    it('refuses a budget that is not a positive number, rather than treating it as unlimited', () => {
        for (const budget of ['abc', '0', '-5']) {
            const { status, err } = run(10, budget)
            expect(status, budget).toBe(1)
            expect(err).toContain('budget argument must be a positive number')
        }
    })

    it('refuses to run without a budget, rather than judging an app by a number that is not its own', () => {
        const { status, err } = run(10)
        expect(status).toBe(1)
        expect(err).toContain("pass this app's budget")
        expect(err).toContain('`check:demo-size`')
    })

    it("holds no number and no budget history of its own, because an adopter must never need to edit keel's script", () => {
        // An upstream merge changes this file, so a number or a dated entry written into it is a conflict on
        // every later merge. The number is each app's package.json argument; the history lives with the app (the starter's DEMO-SIZE.md; the showcase's is in docs/decision-log.md).
        const source = readFileSync(SCRIPT, 'utf8')
        expect(source).not.toMatch(/DEFAULT_BUDGET|\bRE-BASED\b|\bRAISED\b|^\/\/ HISTORY/m)
        expect(source).not.toMatch(/\b\d{3}_?\d{3}\b/)
        expect(source).toContain('DEMO-SIZE.md')
    })
})
