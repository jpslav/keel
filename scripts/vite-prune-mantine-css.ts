import postcss, { type AtRule } from 'postcss'
import type { Plugin } from 'vite'

/**
 * Drops the stylesheet rules the single-file static demo can never match, so the demo carries the CSS of
 * the Mantine components it actually ships and not the whole library's.
 *
 * WHY: `@mantine/core/styles.css` is every component's stylesheet in one file, and the apps import it
 * whole. The starter's bundle reaches 33 of its ~100 component stylesheets (42 component directories in the
 * module graph, 33 with a sheet of their own), so 130 KB of the demo's 231 KB of CSS styled nothing — 15% of
 * the artifact, doing nothing. Mantine ships per-component sheets (`@mantine/core/styles/<Name>.css`) for
 * this, but that is a list a person keeps
 * (and gets wrong silently: an unstyled component passes every test); this finds the same set by asking the
 * bundle itself.
 *
 * HOW: Mantine's components are CSS modules whose class names are hashed (`m_77c9d27d`), and those hashes
 * are written out in the component's JavaScript (`{ root: 'm_77c9d27d' }`) and nowhere else. A rule whose
 * selector needs a hashed class that appears in no shipped file cannot match any element the demo renders,
 * so it is removed. Nothing else is touched: no rule is reordered, rewritten or merged, so the cascade among
 * the rules that remain is the cascade of the full sheet. A new component an app imports ships its hashes,
 * so its rules stay with no list to update.
 *
 * WHAT IT WILL NOT DO, deliberately, because each is the way this could silently unstyle something:
 * - It only reads a hashed class at the TOP LEVEL of a selector. One inside `:not()`, `:is()`, `:where()`
 *   or `:has()` is no requirement (`.a:not(.m_x)` matches precisely when `.m_x` is absent), so such a
 *   selector is never judged by it.
 * - A rule with several selectors goes only when EVERY one of them is dead.
 * - Only rules are judged: an `@keyframes` (whose steps name no class) is never touched, and an at-rule is
 *   removed only once it holds nothing.
 * - Only hashed classes are judged. Every selector with none (element, attribute and `mantine-*` rules,
 *   Panda's utilities, the app's own CSS) is kept.
 */

/** The shape Mantine's CSS modules give a class: `m_` and a 32-bit hash in hex: 8 digits, or fewer when
 *  leading zeros are dropped (`m_77c9d27d`; `m_a74036a` has 7). The floor of 5 allows for a few of them. A
 *  class shorter still is not recognised as hashed, and a selector with no hashed class is KEPT, so the
 *  floor errs toward keeping rules. */
const HASHED_CLASS = /^m_[0-9a-f]{5,8}$/
const HASHED_CLASS_ANYWHERE = /\bm_[0-9a-f]{5,8}\b/g

/** Characters an unescaped CSS identifier is made of, enough to read a class name off a selector. */
const IDENT = /[\w-]/

/**
 * The hashed classes a selector REQUIRES — those written outside every `(...)` and `[...]`. `.m_a .m_b > i`
 * yields both; `.m_a:not(.m_b)` yields only `m_a`; `[data-x='.m_c']` yields none.
 */
export function requiredHashedClasses(selector: string): string[] {
    const required: string[] = []
    let depth = 0
    let quote: string | null = null
    for (let i = 0; i < selector.length; i++) {
        const char = selector[i]!
        if (quote) {
            if (char === '\\') i++
            else if (char === quote) quote = null
            continue
        }
        if (char === '\\') i++
        else if (char === '"' || char === "'") quote = char
        else if (char === '(' || char === '[') depth++
        else if (char === ')' || char === ']') depth = Math.max(0, depth - 1)
        else if (char === '.' && depth === 0) {
            let end = i + 1
            while (end < selector.length && IDENT.test(selector[end]!)) end++
            const name = selector.slice(i + 1, end)
            if (HASHED_CLASS.test(name)) required.push(name)
            i = end - 1
        }
    }
    return required
}

export interface PruneResult {
    css: string
    /** Rules removed because a hashed class they need ships nowhere. */
    removedRules: number
    /** Rules left, counting every one nested in an at-rule. */
    keptRules: number
}

/** The hashed class names written in `shipped` — the JavaScript and HTML the stylesheet is shipped with. */
export function shippedHashedClasses(shipped: string): Set<string> {
    return new Set(shipped.match(HASHED_CLASS_ANYWHERE))
}

/**
 * Removes every rule of `css` that needs a hashed class not in `shipped`. Pure; throws on CSS postcss
 * cannot parse (a stylesheet that broken is not one to guess about).
 */
export function pruneUnreachableRules(css: string, shipped: ReadonlySet<string>): PruneResult {
    const root = postcss.parse(css)
    let removedRules = 0
    let keptRules = 0
    // The at-rules a removed rule sat in: only these can have been emptied BY THIS PASS.
    const touched = new Set<AtRule>()
    root.walkRules((rule) => {
        const unreachable = rule.selectors.every((selector) =>
            requiredHashedClasses(selector).some((name) => !shipped.has(name)),
        )
        if (unreachable) {
            for (let parent = rule.parent; parent?.type === 'atrule'; parent = parent.parent) {
                touched.add(parent as AtRule)
            }
            rule.remove()
            removedRules++
        } else keptRules++
    })
    // An at-rule this pass emptied (a `@media` of removed rules) goes too. One that was empty to begin with
    // (`@layer base {}`, which still orders a cascade layer) and a block-less one (`@layer a;`) stay.
    // Nested at-rules empty from the inside out, so repeat until a pass removes nothing.
    for (let removed = true; removed;) {
        removed = false
        for (const atRule of touched) {
            if (atRule.parent && atRule.nodes?.length === 0) {
                atRule.remove()
                removed = true
            }
        }
    }
    return { css: root.toString(), removedRules, keptRules }
}

function textOf(source: string | Uint8Array): string {
    return typeof source === 'string' ? source : new TextDecoder().decode(source)
}

/**
 * The Vite plugin: at `generateBundle` it reads every non-CSS file of the bundle (the chunks, the page) as
 * the evidence of what ships, and prunes each emitted stylesheet against it.
 *
 * `enforce: 'post'` is load-bearing: Vite emits the one stylesheet (`cssCodeSplit: false`) in its own
 * `generateBundle`, which runs after every ordinary plugin's, so an unmarked plugin would find no
 * stylesheet at all. And register it BEFORE `viteSingleFile()`, the other `post` plugin, which inlines the
 * stylesheet into the page in its own `generateBundle` — plugins of one phase run in array order, so the
 * inlined copy is then the pruned one. A bundle with no stylesheet at this point is an error, never a quiet
 * no-op: a demo always has one, and a plugin that silently stops working is how 130 KB comes back.
 */
export function pruneMantineCss(): Plugin {
    return {
        name: 'keel:prune-mantine-css',
        apply: 'build',
        enforce: 'post',
        generateBundle(_options, bundle) {
            const items = Object.values(bundle)
            const stylesheets = items.filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'))
            if (stylesheets.length === 0) {
                this.error(
                    'keel:prune-mantine-css found no stylesheet in the bundle. It must run after Vite emits it ' +
                        "(`enforce: 'post'`) and before vite-plugin-singlefile inlines it (earlier in `plugins`).",
                )
            }
            const evidence = items
                .filter((item) => !stylesheets.includes(item))
                .map((item) => (item.type === 'chunk' ? item.code : textOf(item.source)))
                .join('\n')
            const shipped = shippedHashedClasses(evidence)
            for (const stylesheet of stylesheets) {
                if (stylesheet.type !== 'asset') continue
                const before = textOf(stylesheet.source)
                const { css, removedRules, keptRules } = pruneUnreachableRules(before, shipped)
                stylesheet.source = css
                this.info(
                    `${stylesheet.fileName}: ${before.length} -> ${css.length} bytes ` +
                        `(${removedRules} of ${removedRules + keptRules} rules unreachable)`,
                )
            }
        },
    }
}
