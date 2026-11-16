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

/** An app directory whose built demo is exactly `bytes` long, checked against `budget` (default: the script's own). */
function run(bytes: number, budget?: string, env: Record<string, string> = {}) {
    const app = makeTestTmpDir('keel-demo-size-')
    mkdirSync(path.join(app, 'dist-demo'))
    writeFileSync(path.join(app, 'dist-demo', 'index.html'), 'x'.repeat(bytes))
    const result = spawnSync(process.execPath, [SCRIPT, ...(budget === undefined ? [] : [budget])], {
        cwd: app,
        encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '', ...env },
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

    it("falls back to the showcase's number when no argument is passed", () => {
        // read from the script, so changing the default on purpose does not also mean editing this test
        const fallback = Number(
            /DEFAULT_BUDGET_BYTES = ([\d_]+)/.exec(readFileSync(SCRIPT, 'utf8'))![1]!.replaceAll('_', ''),
        )
        expect(run(fallback + 1).status).toBe(1)
        expect(run(fallback).status).toBe(0)
    })
})
