import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import {
    pruneMantineCss,
    pruneUnreachableRules,
    requiredHashedClasses,
    shippedHashedClasses,
} from '../../scripts/vite-prune-mantine-css'

/**
 * The static demo's stylesheet is pruned against what the demo ships (scripts/vite-prune-mantine-css.ts).
 * The one way that goes wrong is a rule removed that WAS reachable — a component unstyled in the demo and
 * nowhere else, which no functional test notices. So these tests pin what is judged and, harder, what is
 * not.
 */
const shipped = (...names: string[]) => new Set(names)

describe('requiredHashedClasses', () => {
    it('reads every hashed class a selector needs, at any depth of the combinators', () => {
        expect(requiredHashedClasses('.m_77c9d27d')).toEqual(['m_77c9d27d'])
        expect(requiredHashedClasses('.m_77c9d27d .m_80f1301b > span')).toEqual(['m_77c9d27d', 'm_80f1301b'])
        expect(requiredHashedClasses('.m_77c9d27d.m_80f1301b[data-x]')).toEqual(['m_77c9d27d', 'm_80f1301b'])
    })

    it('reads the seven-digit hashes a leading zero produces', () => {
        expect(requiredHashedClasses('.m_a74036a')).toEqual(['m_a74036a'])
    })

    it('reads nothing a selector does not REQUIRE: inside :not, :is, :where, :has or an attribute', () => {
        expect(requiredHashedClasses('.m_77c9d27d:not(.m_80f1301b)')).toEqual(['m_77c9d27d'])
        expect(requiredHashedClasses(':where(.m_77c9d27d) span')).toEqual([])
        expect(requiredHashedClasses(':is(.m_77c9d27d, .m_80f1301b) i')).toEqual([])
        expect(requiredHashedClasses('div:has(> .m_77c9d27d)')).toEqual([])
        expect(requiredHashedClasses(`[data-x='.m_77c9d27d']`)).toEqual([])
        expect(requiredHashedClasses(`[data-x="a)b"] .m_77c9d27d`)).toEqual(['m_77c9d27d'])
        // a bracket inside a quoted attribute value is text, not nesting: it must not hide or invent a depth
        expect(requiredHashedClasses(`[data-x="("] .m_77c9d27d`)).toEqual(['m_77c9d27d'])
        expect(requiredHashedClasses(`[data-x=")"]:not(.m_80f1301b) .m_77c9d27d`)).toEqual(['m_77c9d27d'])
    })

    it('leaves every other class alone: a longer identifier, a different prefix, an escaped dot', () => {
        expect(requiredHashedClasses('.mantine-Button-root')).toEqual([])
        expect(requiredHashedClasses('.m_77c9d27d-hover')).toEqual([])
        expect(requiredHashedClasses('.m_auto')).toEqual([])
        expect(requiredHashedClasses('.m_123456789')).toEqual([])
        expect(requiredHashedClasses('a\\.m_77c9d27d')).toEqual([])
    })
})

describe('shippedHashedClasses', () => {
    it('collects hashes from quoted strings and class lists, and only whole ones', () => {
        const found = shippedHashedClasses(
            `a={root:"m_77c9d27d"};b="m_80f1301b m_a74036a";c=m_77c9d27dff;d="xm_99999999"`,
        )
        expect([...found].sort()).toEqual(['m_77c9d27d', 'm_80f1301b', 'm_a74036a'])
    })
})

describe('pruneUnreachableRules', () => {
    const css = (rules: string) => pruneUnreachableRules(rules, shipped('m_aaaaaaaa', 'm_bbbbbbbb')).css

    it('removes a rule whose hashed class ships nowhere, and keeps one whose class ships', () => {
        expect(css('.m_aaaaaaaa{color:red}.m_cccccccc{color:blue}.m_bbbbbbbb{color:green}')).toBe(
            '.m_aaaaaaaa{color:red}.m_bbbbbbbb{color:green}',
        )
    })

    it('keeps the order and the text of every rule it keeps', () => {
        const kept = '.m_bbbbbbbb{b:1}\n.m_aaaaaaaa:hover{a:1}\nbody{margin:0}'
        const result = pruneUnreachableRules(
            `.m_dead0001{x:1}\n${kept.split('\n')[0]}\n.m_dead0002{x:2}\n${kept.split('\n').slice(1).join('\n')}`,
            shipped('m_aaaaaaaa', 'm_bbbbbbbb'),
        )
        expect(result.css.replace(/\n+/g, '\n').trim()).toBe(kept)
        expect(result.removedRules).toBe(2)
        expect(result.keptRules).toBe(3)
    })

    it('needs EVERY hashed class of one selector, and ANY one selector of a list, to keep a rule', () => {
        expect(css('.m_aaaaaaaa .m_cccccccc{x:1}')).toBe('')
        expect(css('.m_aaaaaaaa .m_bbbbbbbb{x:1}')).toBe('.m_aaaaaaaa .m_bbbbbbbb{x:1}')
        expect(css('.m_cccccccc,.m_dddddddd{x:1}')).toBe('')
        expect(css('.m_cccccccc,.m_aaaaaaaa{x:1}')).toBe('.m_cccccccc,.m_aaaaaaaa{x:1}')
    })

    it('never judges a rule by a hashed class it does not require', () => {
        // matches exactly when `.m_cccccccc` is ABSENT, so its absence from the bundle is no reason to drop it
        expect(css('.m_aaaaaaaa:not(.m_cccccccc){x:1}')).toBe('.m_aaaaaaaa:not(.m_cccccccc){x:1}')
        expect(css(':where(.m_cccccccc) span{x:1}')).toBe(':where(.m_cccccccc) span{x:1}')
        expect(css("[data-x='m_cccccccc']{x:1}")).toBe("[data-x='m_cccccccc']{x:1}")
    })

    it('keeps every rule that names no hashed class', () => {
        const rules =
            'body{margin:0}.mantine-Button-root{x:1}[data-mantine-color-scheme=dark] .mantine-x{y:1}.d_flex{display:flex}'
        expect(css(rules)).toBe(rules)
    })

    it('prunes inside an at-rule, and removes the at-rule only once nothing is left in it', () => {
        expect(css('@media (min-width:1px){.m_cccccccc{x:1}}.m_aaaaaaaa{y:1}')).toBe('.m_aaaaaaaa{y:1}')
        expect(css('@media (min-width:1px){.m_cccccccc{x:1}.m_aaaaaaaa{y:1}}')).toBe(
            '@media (min-width:1px){.m_aaaaaaaa{y:1}}',
        )
        expect(css('@media screen{@supports (display:grid){.m_cccccccc{x:1}}}')).toBe('')
    })

    it('leaves @keyframes and block-less at-rules alone', () => {
        const rules = '@layer a,b;@keyframes m_cccccccc{from{opacity:0}to{opacity:1}}'
        expect(css(rules)).toBe(rules)
    })

    it('throws on CSS it cannot parse, rather than guess', () => {
        expect(() => css('.m_aaaaaaaa{color:red')).toThrow()
    })
})

describe("against Mantine's real stylesheet", () => {
    const require = createRequire(import.meta.url)
    const core = path.dirname(require.resolve('@mantine/core/styles.css'))
    const sheet = readFileSync(path.join(core, 'styles.css'), 'utf8')
    const componentCode = (...names: string[]) =>
        names
            .map((name) => readFileSync(path.join(core, 'esm', 'components', name, `${name}.module.mjs`), 'utf8'))
            .join('\n')

    /** Every rule's selectors, as written, so two stylesheets can be compared as sets. */
    const selectorsOf = (stylesheet: string) => {
        const found = new Set<string>()
        postcss.parse(stylesheet).walkRules((rule) => {
            found.add(rule.selector)
        })
        return found
    }

    it('keeps what Button ships and drops what only Table styles', () => {
        const { css, removedRules } = pruneUnreachableRules(sheet, shippedHashedClasses(componentCode('Button')))
        const kept = selectorsOf(css)
        expect(kept.has('.m_77c9d27d')).toBe(true) // Button's root
        expect([...kept].some((selector) => selector.includes('.m_b23fa0ef'))).toBe(false) // Table's root
        expect(removedRules).toBeGreaterThan(300)
        expect(css.length).toBeLessThan(sheet.length / 4)
    })

    it('never removes a rule the shipped components can match, and never keeps one they cannot', () => {
        const evidence = shippedHashedClasses(componentCode('Button', 'Text', 'Card'))
        const { css } = pruneUnreachableRules(sheet, evidence)
        const kept = selectorsOf(css)
        postcss.parse(sheet).walkRules((rule) => {
            if (rule.parent?.type === 'atrule' && /keyframes$/i.test((rule.parent as { name: string }).name)) return
            const required = rule.selectors.map(requiredHashedClasses)
            const reachable = required.some((names) => names.every((name) => evidence.has(name)))
            // a selector list is kept when ANY of its selectors is reachable (rules inside a kept at-rule too)
            expect(kept.has(rule.selector), rule.selector).toBe(reachable)
        })
    })
})

describe('pruneMantineCss (the Vite plugin)', () => {
    type Bundle = Record<string, unknown>
    const run = (bundle: Bundle) => {
        const messages: string[] = []
        const plugin = pruneMantineCss()
        const hook = plugin.generateBundle as (this: unknown, options: unknown, bundle: Bundle) => void
        hook.call(
            {
                info: (message: string) => messages.push(message),
                error: (message: string) => {
                    throw new Error(message)
                },
            },
            {},
            bundle,
        )
        return { messages, plugin }
    }

    it('prunes the emitted stylesheet against the chunks and the page, and nothing else', () => {
        const bundle = {
            'index.js': { type: 'chunk', fileName: 'index.js', code: 'x={root:"m_aaaaaaaa"}' },
            'index.html': { type: 'asset', fileName: 'index.html', source: '<div class="m_bbbbbbbb">' },
            'style.css': {
                type: 'asset',
                fileName: 'style.css',
                // a stylesheet's own selectors are no evidence that anything ships them
                source: '.m_aaaaaaaa{a:1}.m_bbbbbbbb{b:1}.m_cccccccc{c:1}',
            },
        }
        const { messages } = run(bundle)
        expect(bundle['style.css'].source).toBe('.m_aaaaaaaa{a:1}.m_bbbbbbbb{b:1}')
        expect(bundle['index.html'].source).toBe('<div class="m_bbbbbbbb">')
        expect(messages.join()).toContain('1 of 3 rules unreachable')
    })

    it('runs after Vite has emitted the stylesheet, and fails loudly when it finds none', () => {
        expect(pruneMantineCss().enforce).toBe('post')
        expect(() => run({ 'index.js': { type: 'chunk', fileName: 'index.js', code: '' } })).toThrow(
            /found no stylesheet/,
        )
    })
})
