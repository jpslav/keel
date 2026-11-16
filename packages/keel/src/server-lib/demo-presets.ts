import { appPresetOperationHandlers } from '@app-config/preset-operations'
import { presets } from '@app-config/presets'
import { devSignIn } from '../adapters/fake/auth'
import { resetWorldThen } from '../adapters/fake/simulator-admin'
import { expandPreset, type PresetOperation } from '../core/presets'
import { NotFoundError } from '../ports/errors'
import { frameworkPresetOperationHandlers, type ServerPresetOperationHandler } from './preset-operations'

/**
 * The SERVER host's replay of a demo preset (keel/core/presets.ts): reset the world to the seed, then
 * perform each operation through its kind's server half — keel's (./preset-operations.ts) or the app's
 * (`@app-config/preset-operations`) — and finally sign the RESTORING browser in as the preset's
 * viewpoint. The static twin replays the same list through its in-memory world (keel/demo-static/world.ts).
 *
 * Simulated mode only: every caller is a `/api/simulator/*` route behind its `isSimulated` 404. There
 * is no session to authorize against — a preset is a simulated-world operation, like compose-inbound —
 * so the authorization question is answered at BUILD time instead: keel's seam-conformance suite holds
 * every registered preset to the rules the product enforces (`presetProblems`). An operation the
 * world cannot perform therefore throws here rather than being skipped, because reaching one means the
 * conformance gate was bypassed.
 *
 * The viewpoint is the restorer's alone (cookies on THIS response); other browsers watching the same
 * world keep theirs. See `DemoPreset.viewpoint`.
 */
export async function applyDemoPreset(id: string, options: { baseUrl: string }): Promise<{ signedIn: boolean }> {
    // The `extends` chain flattened (keel/core/presets.ts `expandPreset`): null is an unknown id, and also
    // a preset whose chain names an unknown base or loops — both of which the conformance gate rejects.
    const preset = expandPreset(id, presets)
    if (!preset) throw new NotFoundError(`unknown preset: ${id}`)

    // The reset and the whole script run as ONE turn of the world's queue, so a second load (or a reset,
    // save or restore) arriving meanwhile waits for this one instead of interleaving with it.
    return resetWorldThen(async () => {
        // Named results live for one replay: a name is the id a step created in THIS world.
        const refs = new Map<string, string>()
        for (const operation of preset.operations) {
            await performPresetOperation(operation, { baseUrl: options.baseUrl, refs })
        }

        if (preset.viewpoint === undefined) return { signedIn: false }
        await devSignIn(preset.viewpoint)
        return { signedIn: true }
    })
}

/**
 * Every kind's server half: keel's, then the app's, keyed by kind — so an app entry with keel's kind name
 * REPLACES keel's (the same composition as the definitions, `composePresetOperations`). Exported for the
 * seam-conformance suite, which holds it to the definitions both ways.
 */
export const presetOperationHandlers: Readonly<Record<string, ServerPresetOperationHandler>> = {
    ...frameworkPresetOperationHandlers,
    ...appPresetOperationHandlers,
}

/**
 * The ONE dispatcher: run an operation's kind's half with the operation's arguments (everything but `op`
 * and `as`), then bind its result to `as`. An unregistered kind, a name no earlier step bound, and an `as`
 * on a step that created nothing are all NotFoundErrors — each is a preset the conformance gate refuses.
 */
async function performPresetOperation(
    operation: PresetOperation,
    ctx: { baseUrl: string; refs: Map<string, string> },
): Promise<void> {
    const { op, as, ...args } = operation
    // An own-property lookup, so a kind named like an Object.prototype member is just unknown.
    const handler = Object.hasOwn(presetOperationHandlers, op) ? presetOperationHandlers[op] : undefined
    if (!handler) throw new NotFoundError(`unknown preset operation: ${op}`)

    const result = await handler(args, {
        baseUrl: ctx.baseUrl,
        refs: {
            resolve(name) {
                const bound = ctx.refs.get(name)
                if (bound === undefined) throw new NotFoundError(`no earlier operation is named "${name}"`)
                return bound
            },
        },
    })

    if (as === undefined) return
    const ref = result ? result.ref : undefined
    if (ref === undefined) throw new NotFoundError(`operation "${op}" created nothing to name "${as}"`)
    ctx.refs.set(as, ref)
}
