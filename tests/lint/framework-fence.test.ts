import { symlinkSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import { makeTestTmpDir } from '../support/tmp-dir'
import {
    APP,
    APP_CODE_DYNAMIC,
    APP_CODE_PATH,
    APP_CODE_STATIC,
    BARE_TRAVERSAL_DYNAMIC,
    BARE_TRAVERSAL_STATIC,
    CORE_DYNAMIC,
    CORE_STATIC,
    type Fence,
    fired,
    JSX_IN_CORE,
    lint,
    NODE_MODULES_DYNAMIC,
    NODE_MODULES_STATIC,
    VENDOR_DYNAMIC,
    VENDOR_STATIC,
} from './lint-text'

/**
 * Two of ADR-0012's fences are no-restricted-imports groups: the framework/app fence (keel and its fixture
 * reach app content only through `@app-config/*`) and keel/core's framework ban (ADR-0006). That rule sees
 * import and export DECLARATIONS only, so until `keel/no-dynamic-app-import` and
 * `keel/no-dynamic-framework-import-in-core` existed, `import('@app/seed')` in keel's server-lib and
 * `export type T = import('@/domain/tickets').Ticket` in keel's fixture linted clean. The second is the
 * type-only escape the fixture's fence exists to stop: erased at runtime, resolved by the root tsc, and
 * broken only at `pnpm init-app --eject-showcase`.
 *
 * The new rules read the same patterns through the same matchers as no-restricted-imports (eslint.config.mjs,
 * `patternMatcher`), and the parity table below holds them to it, specifier by specifier.
 */
const KEEL = [
    'packages/keel/src/server-lib/kv.ts',
    'packages/keel/src/adapters/real/kv.ts',
    'packages/keel/src/core/kv.ts',
]
const FIXTURE = 'packages/keel/test-fixture/domain/kv.ts'

describe('the framework/app fence holds outside declarations', () => {
    const forms: [string, string][] = [
        ['import()', "export const load = () => import('@app/seed')\n"],
        ['import() with a template literal', 'export const load = () => import(`@/domain/tickets`)\n'],
        ['require()', "export const seed = require('@app/seed/world')\n"],
        ['a type-position import()', "export type Ticket = import('@/domain/tickets').Ticket\n"],
        ['typeof import()', "export type Seed = typeof import('@app/seed')\n"],
    ]

    describe.each([...KEEL, FIXTURE, 'packages/keel/src/components/kv-panel.mjs'])('%s', (file) => {
        // A `.mjs` file has no type positions, so it gets the runtime forms only.
        const applicable = file.endsWith('.mjs') ? forms.filter(([form]) => !form.includes('type')) : forms
        it.each(applicable)('may not reach app content by %s', async (_form, code) => {
            expect(fired(await lint(file, code), APP_CODE_DYNAMIC)).toBe(1)
        })
    })

    it('a keel test may not load app content with vi.importActual either', async () => {
        const code = "import { vi } from 'vitest'\nexport const load = () => vi.importActual('@app/seed')\n"
        expect(fired(await lint('packages/keel/src/server-lib/kv.test.ts', code), APP_CODE_DYNAMIC)).toBe(1)
    })

    // TypeScript's `import m = require()` is a declaration to no-restricted-imports (TSImportEqualsDeclaration), so
    // the pattern's own half bans it, and the declarationless rule leaves it alone: one finding, not two.
    it.each([...KEEL, FIXTURE])('%s may not reach app content by import = require() either', async (file) => {
        const findings = await lint(file, "import seed = require('@app/seed')\nexport { seed }\n")
        expect(fired(findings, APP_CODE_STATIC)).toBe(1)
        expect(fired(findings, APP_CODE_DYNAMIC)).toBe(0)
    })

    it('the seam stays open: @app-config/* by import() or in a type', async () => {
        const code = [
            "export const load = () => import('@app-config/jobs')",
            // a seam module whose path happens to contain an apps/ segment is still the seam
            "export const registry = () => import('@app-config/apps/registry')",
            "export type Jobs = import('@app-config/jobs').AppJobs",
            "export const local = () => import('./local')",
        ].join('\n')
        expect(fired(await lint(FIXTURE, code), APP_CODE_DYNAMIC)).toBe(0)
    })

    // An app's tsconfig maps `@/*` to `./src/*`, so `@//domain/tickets` is `./src//domain/tickets` to TypeScript:
    // the alias with an empty segment, which a `@/*` group does not match. Every spelling is one finding, in each half.
    it.each([
        '@/domain/tickets',
        '@//domain/tickets',
        '@///domain\\tickets',
        '@app/seed',
        '@app/seed/world',
        '@app//seed/world',
    ])('the app’s alias spelled %s is one finding, in each half', async (specifier) => {
        const at = JSON.stringify(specifier)
        const declared = await lint(FIXTURE, `import { x } from ${at}\nexport { x }\n`)
        expect(fired(declared, APP_CODE_STATIC)).toBe(1)
        const loaded = await lint(FIXTURE, `export const load = () => import(${at})\n`)
        expect(fired(loaded, APP_CODE_DYNAMIC)).toBe(1)
    })

    it('an app reaching its own @/* alias is not crossing the fence', async () => {
        const code =
            "export const load = () => import('@/domain/tickets')\nexport type T = import('@/domain/tickets').T\n"
        expect(fired(await lint(`${APP}/src/app/api/kv/route.ts`, code), APP_CODE_DYNAMIC)).toBe(0)
    })
})

describe('keel/core stays framework-free outside declarations', () => {
    const CORE = 'packages/keel/src/core/kv.ts'

    it.each([
        ['import()', "export const load = () => import('next/headers')\n"],
        ['a mid-name wildcard (react-*)', "export const load = () => import('react-dom/client')\n"],
        ['require()', "export const ui = require('@mantine/core')\n"],
        ['a type-position import()', "export type Node = import('react').ReactNode\n"],
        ['next-intl', "export const load = () => import('next-intl/server')\n"],
    ])('may not reach a framework by %s', async (_form, code) => {
        expect(fired(await lint(CORE, code), CORE_DYNAMIC)).toBe(1)
    })

    it('nor by import = require(), which the declaration half bans: one finding, not two', async () => {
        const findings = await lint(CORE, "import React = require('react')\nexport { React }\n")
        expect(fired(findings, CORE_STATIC)).toBe(1)
        expect(fired(findings, CORE_DYNAMIC)).toBe(0)
    })

    it('a library that is not a framework is fine', async () => {
        const code = "export const load = () => import('./pure')\nexport type Schema = import('zod').ZodType\n"
        expect(fired(await lint(CORE, code), CORE_DYNAMIC)).toBe(0)
    })

    it('outside core the framework ban does not apply', async () => {
        const code = "export const load = () => import('react-dom/client')\n"
        expect(fired(await lint('packages/keel/src/server-lib/kv.ts', code), CORE_DYNAMIC)).toBe(0)
    })
})

// The declarationless rules must read each group exactly as no-restricted-imports does, or the two halves
// of one fence disagree and the gap between them is a hole. Every specifier here is linted twice, once as a
// declaration and once as import(), and both must agree, including on the group syntax's quirks: a bare
// name matches at any depth (`@x/react`, `./react`), and matching ignores case (`React`).
describe('the two halves of each fence read the group the same way', () => {
    const SPECIFIERS = [
        'react',
        'React',
        // no-restricted-imports trims the specifier before matching, so the other half must too
        ' react',
        'react-dom',
        'react-dom/client',
        '@x/react',
        './react',
        'preact',
        'reactive',
        'next',
        'next/headers',
        'next-intl',
        'next-intl/server',
        'nextra',
        '@mantine/core',
        '@/x',
        '@/domain/tickets',
        '@app/seed',
        '@app/seed/world',
        '@app/seedling',
        '@app-config/jobs',
        // a `..` in a package or alias specifier climbs out of it (bareTraversalPattern, a regex: compiled `iu`
        // by no-restricted-imports, so by the declarationless half too)
        '@app-config/../seed',
        '@app-config/..\\proxy',
        '@app-config/x/../y',
        '@scope/../../apps/showcase/src/domain/tickets',
        '@SCOPE/../../apps/showcase/src/domain/tickets',
        'lodash/../../packages/seed/src/index',
        '.x/../../apps/showcase/src/domain/tickets',
        '.pnpm/../../apps/showcase/src/domain/tickets',
        '@\\..\\..\\apps\\showcase\\src\\domain\\tickets',
        '@//../../apps/showcase/src/domain/tickets',
        // ...but not one that does not climb
        '@app-config/apps/registry',
        '@app-config/x..y',
        // a specifier two patterns match is two findings, in BOTH halves: each reports every pattern it matches
        '@/../domain/tickets',
        '@app/seed/../world',
        'lodash/../../node_modules/.pnpm/node_modules/showcase/src/domain/tickets',
        // a package reached through node_modules, where pnpm links the apps and the seed (nodeModulesPathPattern)
        '.pnpm/node_modules/showcase/src/domain/tickets',
        'node_modules/@app/seed',
        '../../../../node_modules/.pnpm/node_modules/showcase/src/domain/tickets',
        '..\\..\\NODE_MODULES\\showcase',
        // ...but not a name that merely contains it
        './node_modules-cache/x',
    ]
    const halves: [string, string, Fence, Fence][] = [
        ['keel/core', 'packages/keel/src/core/kv.ts', CORE_STATIC, CORE_DYNAMIC],
        ['the framework/app fence', 'packages/keel/src/server-lib/kv.ts', APP_CODE_STATIC, APP_CODE_DYNAMIC],
        ['the fixture', FIXTURE, APP_CODE_STATIC, APP_CODE_DYNAMIC],
    ]

    describe.each(halves)('%s', (_name, file, staticFence, dynamicFence) => {
        it.each(SPECIFIERS)('%s', async (specifier) => {
            // JSON.stringify writes the specifier as source text, so a backslash in it survives into the value.
            const at = JSON.stringify(specifier)
            const declared = fired(await lint(file, `import x from ${at}\nexport { x }\n`), staticFence)
            const loaded = fired(await lint(file, `export const load = () => import(${at})\n`), dynamicFence)
            expect(loaded, `static ${declared}, import() ${loaded}`).toBe(declared)
        })
    })

    it('the table is not vacuous: some specifiers are banned in each zone, and some are not', async () => {
        const core = 'packages/keel/src/core/kv.ts'
        expect(fired(await lint(core, "export const l = () => import('@x/react')\n"), CORE_DYNAMIC)).toBe(1)
        expect(fired(await lint(core, "export const l = () => import('nextra')\n"), CORE_DYNAMIC)).toBe(0)
        expect(fired(await lint(FIXTURE, "export const l = () => import('@app/seed/world')\n"), APP_CODE_DYNAMIC)).toBe(
            1,
        )
        expect(fired(await lint(FIXTURE, "export const l = () => import('@app/seedling')\n"), APP_CODE_DYNAMIC)).toBe(0)
    })
})

// The same app code by PATH: `../../../../apps/showcase/src/domain/tickets` from keel's server-lib is the file
// the app's `@/*` alias names, and `../../../seed/src/index` is `@app/seed`. keel/no-path-to-app-code resolves a
// relative or absolute path against the importing file and reports it if it lands in apps/ or packages/seed/,
// in a declaration and everywhere else alike.
describe('a path into app code crosses the framework/app fence too', () => {
    // The path from `file` to `target`, as an importer would write it.
    const pathFrom = (file: string, target: string) => path.relative(path.dirname(file), target)
    // TypeScript resolves all of these to the same file; the rule ignores case, as macOS's file system does.
    const spellings = (to: string): [string, string][] => [
        ['posix', to],
        ['a doubled slash', to.replace('/', '//')],
        ['backslashes', to.replaceAll('/', '\\')],
        ['another case', to.replace('apps', 'Apps').replace('seed', 'Seed')],
    ]
    const forms = (at: string): [string, string][] => [
        ['a declaration', `import type { T } from ${at}\nexport type U = T\n`],
        ['a re-export', `export { T } from ${at}\n`],
        ['import()', `export const load = () => import(${at})\n`],
        ['a type-position import()', `export type U = import(${at}).T\n`],
        ['require()', `export const m = require(${at})\n`],
        ['import = require()', `import m = require(${at})\nexport { m }\n`],
    ]

    describe.each([...KEEL, FIXTURE, 'packages/keel/src/server-lib/kv.test.ts'])('%s', (file) => {
        describe.each([
            ['an app', 'apps/showcase/src/domain/tickets'],
            ['the seed package', 'packages/seed/src/index'],
        ])('into %s', (_target, target) => {
            it.each(spellings(pathFrom(file, target)))('spelled with %s, in every form', async (_spelling, to) => {
                for (const [form, code] of forms(JSON.stringify(to))) {
                    expect(fired(await lint(file, code), APP_CODE_PATH), form).toBe(1)
                }
            })
        })
    })

    it('an absolute path into apps/ too', async () => {
        const to = JSON.stringify(path.join(process.cwd(), 'apps/showcase/src/domain/tickets'))
        expect(fired(await lint(FIXTURE, `export const load = () => import(${to})\n`), APP_CODE_PATH)).toBe(1)
    })

    // Node loads a `file:` URL as the absolute path it names, so it is a path too, in any case of the scheme.
    it.each([
        ['into apps/', 'apps/showcase/src/domain/tickets.ts', 1],
        ['into the seed package', 'packages/seed/src/index.ts', 1],
        ['anywhere else', 'tests/support/tmp-dir.ts', 0],
    ])('a file: URL %s', async (_where, target, expected) => {
        const url = pathToFileURL(path.join(process.cwd(), target)).href
        for (const spelled of [url, url.replace('file:', 'FILE:')]) {
            const code = `export const load = () => import(${JSON.stringify(spelled)})\n`
            expect(fired(await lint(FIXTURE, code), APP_CODE_PATH), spelled).toBe(expected)
        }
    })

    // A `file:` URL with a literal `..` is still a path (pathToFileURL would normalize the `..` away, so it is
    // written out): the path rule judges where it lands, and the traversal ban, which is for package specifiers,
    // stays out of it.
    it.each([
        ['into apps/', 'packages/keel/../../apps/showcase/src/domain/tickets.ts', 1],
        ['anywhere else', 'packages/keel/../../tests/support/tmp-dir.ts', 0],
    ])('a file: URL with a `..` %s', async (_where, rest, expected) => {
        const url = `${pathToFileURL(process.cwd()).href}/${rest}`
        const declared = await lint(FIXTURE, `import { x } from ${JSON.stringify(url)}\nexport { x }\n`)
        expect(fired(declared, APP_CODE_PATH)).toBe(expected)
        expect(fired(declared, APP_CODE_STATIC)).toBe(0)
        const loaded = await lint(FIXTURE, `export const load = () => import(${JSON.stringify(url)})\n`)
        expect(fired(loaded, APP_CODE_PATH)).toBe(expected)
        expect(fired(loaded, APP_CODE_DYNAMIC)).toBe(0)
    })

    it('every other path out of keel stays open: its own modules, and the repo’s test helpers', async () => {
        const file = 'packages/keel/src/server-lib/kv.test.ts'
        const code = [
            "import { a } from '../core/x'",
            `import { b } from ${JSON.stringify(pathFrom(file, 'tests/support/tmp-dir'))}`,
            "import { c } from '../../../apps-config/x'",
            'export { a, b, c }',
        ].join('\n')
        const findings = await lint(file, code)
        // ...and a relative path's `..` is not the bare-specifier traversal ban's business either
        expect(fired(findings, APP_CODE_PATH) + fired(findings, BARE_TRAVERSAL_STATIC)).toBe(0)
    })

    it('a `..` that is part of a name, not a segment, climbs nowhere', async () => {
        const code = "import { a } from '@app-config/x..y'\nimport { b } from 'pkg/a..b/c'\nexport { a, b }\n"
        expect(fired(await lint('packages/keel/src/server-lib/kv.ts', code), BARE_TRAVERSAL_STATIC)).toBe(0)
    })

    it('an app reaching another app by path is not this fence’s business', async () => {
        const file = `${APP}/src/domain/kv.ts`
        const code = `export const load = () => import(${JSON.stringify(pathFrom(file, 'apps/starter/src/seed'))})\n`
        expect(fired(await lint(file, code), APP_CODE_PATH)).toBe(0)
    })

    // `@scope/../../apps/…` and `@app-config/../seed` are package and alias specifiers, not paths: TypeScript
    // resolves them out of node_modules or the seam into app code. bareTraversalPattern bans the `..`, in both
    // halves (the parity table holds them together). A specifier that is also the app's alias is that pattern's
    // finding too: two, not one, since no pattern exempts what another bans.
    describe.each([...KEEL, FIXTURE])('%s', (file) => {
        it.each([
            ['@app-config/../seed', 1],
            ['@app-config/../domain/tickets', 1],
            ['@app-config/x/../../seed', 1],
            ['@scope/../../apps/showcase/src/domain/tickets', 1],
            ['lodash/../../packages/seed/src/index', 1],
            // a name that starts with a dot is a package name, not a path: only `./` and `../` are relative
            ['.x/../../apps/showcase/src/domain/tickets', 1],
            ['.pnpm/../../apps/showcase/src/domain/tickets', 1],
            // the app's alias, spelled with a backslash (read as a slash) or an empty segment, and climbing
            ['@\\..\\..\\apps\\showcase\\src\\domain\\tickets', 2],
            ['@app\\seed\\..\\..\\..\\apps\\showcase\\src\\domain\\tickets', 2],
            ['@//../../apps/showcase/src/domain/tickets', 2],
            ['@///../../apps/showcase/src/domain/tickets', 2],
        ] as const)('may not climb out of a package or alias with %s, in either half', async (specifier, findings) => {
            const at = JSON.stringify(specifier)
            const declared = await lint(file, `import { seed } from ${at}\nexport { seed }\n`)
            expect(fired(declared, BARE_TRAVERSAL_STATIC)).toBe(1)
            expect(fired(declared, APP_CODE_STATIC)).toBe(findings)
            const loaded = await lint(file, `export const load = () => import(${at})\n`)
            expect(fired(loaded, BARE_TRAVERSAL_DYNAMIC)).toBe(1)
            expect(fired(loaded, APP_CODE_DYNAMIC)).toBe(findings)
        })
    })

    // pnpm links the apps and the seed, among other workspace packages, into node_modules/.pnpm/node_modules,
    // so a specifier through node_modules reaches app code by where pnpm put it rather than by its name, whether
    // it is spelled as a package or as a path. nodeModulesPathPattern bans it in both halves; the path rule
    // leaves it to that pattern, so it is one finding, not two.
    describe.each([...KEEL, FIXTURE])('%s', (file) => {
        it.each([
            '.pnpm/node_modules/showcase/src/domain/tickets',
            'node_modules/@app/seed/src/index',
            pathFrom(file, 'node_modules/.pnpm/node_modules/showcase/src/domain/tickets'),
            pathFrom(file, 'node_modules/.pnpm/node_modules/@app/seed/src/index').replaceAll('/', '\\'),
        ])('may not reach a package through node_modules with %s, in either half', async (specifier) => {
            const at = JSON.stringify(specifier)
            const declared = await lint(file, `import { seed } from ${at}\nexport { seed }\n`)
            expect(fired(declared, NODE_MODULES_STATIC)).toBe(1)
            expect(fired(declared, APP_CODE_PATH)).toBe(0)
            const loaded = await lint(file, `export const load = () => import(${at})\n`)
            expect(fired(loaded, NODE_MODULES_DYNAMIC)).toBe(1)
            expect(fired(loaded, APP_CODE_PATH)).toBe(0)
        })
    })

    it('a name that merely contains node_modules is not one', async () => {
        const code =
            "import { a } from './node_modules-cache/x'\nimport { b } from '@scope/my_node_modules'\nexport { a, b }\n"
        const findings = await lint('packages/keel/src/server-lib/kv.ts', code)
        expect(fired(findings, NODE_MODULES_STATIC)).toBe(0)
    })

    // The path is judged by where it really lands. Opened through a symlink to the checkout, as an editor's
    // workspace can be, every file's path starts somewhere the config's own directory does not; resolved
    // lexically, `../../../../apps/…` would then land outside the repo and in no app at all.
    it('through a symlink to the checkout, a path into apps/ is still one', async () => {
        const link = path.join(makeTestTmpDir('fence-symlink-'), 'checkout')
        symlinkSync(process.cwd(), link, 'dir')
        try {
            const eslint = new ESLint({ cwd: link })
            const file = 'packages/keel/src/server-lib/kv.ts'
            const lintThrough = async (code: string) => {
                const [result] = await eslint.lintText(code, { filePath: path.join(link, file) })
                expect(
                    result.messages.filter((m) => !m.ruleId),
                    'not actually linted',
                ).toEqual([])
                return result.messages.map((m) => ({ rule: m.ruleId as string, message: m.message }))
            }
            const into = JSON.stringify(pathFrom(file, 'apps/showcase/src/domain/tickets'))
            expect(fired(await lintThrough(`export const load = () => import(${into})\n`), APP_CODE_PATH)).toBe(1)
            const out = JSON.stringify(pathFrom(file, 'tests/support/tmp-dir'))
            expect(fired(await lintThrough(`export const load = () => import(${out})\n`), APP_CODE_PATH)).toBe(0)
        } finally {
            // the link, never what it points at: the scratch directory's own removal must find nothing to follow
            unlinkSync(link)
        }
    })
})

// JSX in keel/core imports react/jsx-runtime without naming it ("jsx": "react-jsx" in tsconfig.json), so
// neither half of core's import ban can see it. The JSX itself is the finding: each outermost element or fragment.
describe('keel/core holds no JSX', () => {
    it.each([
        ['an element', 'export const C = () => <div>{1}</div>\n'],
        [
            'nested elements, reported once',
            'export const C = () => (\n    <ul>\n        <li>{1}</li>\n        <li>{2}</li>\n    </ul>\n)\n',
        ],
        ['a fragment', 'export const C = () => <>{1}</>\n'],
    ])('%s', async (_form, code) => {
        expect(fired(await lint('packages/keel/src/core/view.tsx', code), JSX_IN_CORE)).toBe(1)
    })

    // Each outermost element is a finding, so a disable comment on one does not hide the next.
    it('two elements are two findings, and disabling one leaves the other', async () => {
        const two = 'export const A = () => <div>{1}</div>\nexport const B = () => <span>{2}</span>\n'
        expect(fired(await lint('packages/keel/src/core/view.tsx', two), JSX_IN_CORE)).toBe(2)
        const disabled =
            '// eslint-disable-next-line keel/no-jsx-in-core\nexport const A = () => <div>{1}</div>\n' +
            'export const B = () => <span>{2}</span>\n'
        expect(fired(await lint('packages/keel/src/core/view.tsx', disabled), JSX_IN_CORE)).toBe(1)
    })

    it('a .jsx file in core too', async () => {
        const code = 'export const C = () => <p>{1}</p>\n'
        expect(fired(await lint('packages/keel/src/core/view.jsx', code), JSX_IN_CORE)).toBe(1)
    })

    it('outside core, JSX is just JSX', async () => {
        const code = 'export const C = () => <div>{1}</div>\n'
        expect(fired(await lint('packages/keel/src/components/kv-panel.tsx', code), JSX_IN_CORE)).toBe(0)
    })
})

// The vendor fence's declarationless rule gained the type position too: `import type` of a vendor SDK is
// banned by no-restricted-imports, and the inline form was not.
describe('a vendor SDK named in a type import() is still a vendor import', () => {
    const code = "export type Client = import('@aws-sdk/client-s3').S3Client\n"

    it.each([`${APP}/src/domain/kv.ts`, 'packages/keel/src/server-lib/kv.ts', FIXTURE])('%s may not', async (file) => {
        expect(fired(await lint(file, code), VENDOR_DYNAMIC)).toBe(1)
    })

    it.each([`${APP}/src/adapters/real/kv.ts`, 'packages/keel/src/adapters/real/kv.ts'])('%s may', async (file) => {
        expect(fired(await lint(file, code), VENDOR_DYNAMIC)).toBe(0)
    })
})

// The vendor ban's declaration half sees TypeScript's `import m = require()`, so the declarationless rule leaves it
// alone: one finding, not two.
describe('a vendor SDK reached by import = require() is one finding, from the declaration half', () => {
    const code = "import s3 = require('@aws-sdk/client-s3')\nexport { s3 }\n"

    it.each([`${APP}/src/domain/kv.ts`, 'packages/keel/src/server-lib/kv.ts', FIXTURE])('%s may not', async (file) => {
        const findings = await lint(file, code)
        expect(fired(findings, VENDOR_STATIC)).toBe(1)
        expect(fired(findings, VENDOR_DYNAMIC)).toBe(0)
    })

    it.each([`${APP}/src/adapters/real/kv.ts`, 'packages/keel/src/adapters/real/kv.ts'])('%s may', async (file) => {
        const findings = await lint(file, code)
        expect(fired(findings, VENDOR_STATIC) + fired(findings, VENDOR_DYNAMIC)).toBe(0)
    })
})
