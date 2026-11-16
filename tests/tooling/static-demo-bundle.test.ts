import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

/**
 * What the static demo's bundle may contain is a property of how a module is WRITTEN, and the size budget
 * (scripts/check-demo-size.mjs) only sees it as a total that drifts. These tests pin the shape of the
 * modules the demo imports, so a regression names its cause instead of tipping a budget a release later.
 */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** Bundles a tiny entry the way the static demo imports the module, and says what survived. */
async function bundleOf(entry: string): Promise<{ code: string; validatorBytes: number }> {
    const result = await build({
        stdin: { contents: entry, resolveDir: REPO_ROOT, loader: 'ts' },
        bundle: true,
        write: false,
        metafile: true,
        format: 'esm',
        platform: 'browser',
        treeShaking: true,
        logLevel: 'silent',
    })
    const outputs = Object.values(result.metafile.outputs)
    const validatorBytes = outputs
        .flatMap((output) => Object.entries(output.inputs))
        .filter(([input]) => input.includes('/valibot/'))
        .reduce((sum, [, { bytesInOutput }]) => sum + bytesInOutput, 0)
    return { code: result.outputFiles[0]!.text, validatorBytes }
}

describe('keel/core/presets, as the static demo imports it', () => {
    // The demo imports expandPreset / resolveWorldStart / isReservedWorldStartName and never validates a
    // preset: presetProblems is the seam-conformance gate's, and runs in tests. A module-level
    // `v.strictObject(...)` is a call the bundler cannot drop, so when keel's own operation definitions were
    // constants it carried valibot and four schemas into every app's file:// bundle (3.2 KB on the starter,
    // which registers no preset at all). They are built by function now, and that is what this holds.
    it('carries no validator: valibot and the operation schemas stay out of the bundle', async () => {
        const { code, validatorBytes } = await bundleOf(
            "import { expandPreset, resolveWorldStart, isReservedWorldStartName } from './packages/keel/src/core/presets'\n" +
                'console.log(expandPreset, resolveWorldStart, isReservedWorldStartName)',
        )
        expect(validatorBytes).toBe(0)
        expect(code).not.toContain('abortPipeEarly') // valibot's own, so a rename of keel's schemas cannot hide it
        expect(code).not.toContain('strictObject')
    })

    it('still carries the validator when the conformance entry points ask for it (the probe can see it)', async () => {
        const { validatorBytes } = await bundleOf(
            "import { composePresetOperations } from './packages/keel/src/core/presets'\n" +
                'console.log(composePresetOperations([]))',
        )
        expect(validatorBytes).toBeGreaterThan(0)
    })
})
