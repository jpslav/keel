import path from 'node:path'
import { describe, expect, it } from 'vitest'
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
    VENDOR_DYNAMIC,
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
        // ...but not one that does not climb, nor one appCodePattern already bans whole (one finding, not two)
        '@app-config/apps/registry',
        '@app-config/x..y',
        '@/../domain/tickets',
        '@app/seed/../world',
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

    it('every other path out of keel stays open: its own modules, and the repo’s test helpers', async () => {
        const file = 'packages/keel/src/server-lib/kv.test.ts'
        const code = [
            "import { a } from '../core/x'",
            `import { b } from ${JSON.stringify(pathFrom(file, 'tests/support/tmp-dir'))}`,
            "import { c } from '../../../apps-config/x'",
            'export { a, b, c }',
        ].join('\n')
        expect(fired(await lint(file, code), APP_CODE_PATH)).toBe(0)
    })

    it('an app reaching another app by path is not this fence’s business', async () => {
        const file = `${APP}/src/domain/kv.ts`
        const code = `export const load = () => import(${JSON.stringify(pathFrom(file, 'apps/starter/src/seed'))})\n`
        expect(fired(await lint(file, code), APP_CODE_PATH)).toBe(0)
    })

    // `@scope/../../apps/…` and `@app-config/../seed` are package and alias specifiers, not paths: Node, webpack
    // and TypeScript resolve them out of node_modules or the seam into app code. bareTraversalPattern bans
    // the `..`, in both halves (the parity table holds them together).
    describe.each([...KEEL, FIXTURE])('%s', (file) => {
        it.each([
            '@app-config/../seed',
            '@app-config/../domain/tickets',
            '@app-config/x/../../seed',
            '@scope/../../apps/showcase/src/domain/tickets',
            'lodash/../../packages/seed/src/index',
        ])('may not climb out of a package or alias with %s, in either half', async (specifier) => {
            const at = JSON.stringify(specifier)
            const declared = `import { seed } from ${at}\nexport { seed }\n`
            expect(fired(await lint(file, declared), BARE_TRAVERSAL_STATIC)).toBe(1)
            const loaded = `export const load = () => import(${at})\n`
            expect(fired(await lint(file, loaded), BARE_TRAVERSAL_DYNAMIC)).toBe(1)
        })
    })
})

// JSX in keel/core imports react/jsx-runtime without naming it ("jsx": "react-jsx" in tsconfig.json), so
// neither half of core's import ban can see it. The JSX itself is the finding, once per file.
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
