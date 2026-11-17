import { describe, expect, it } from 'vitest'
import {
    APP,
    APP_CODE_DYNAMIC,
    APP_CODE_STATIC,
    CORE_DYNAMIC,
    CORE_STATIC,
    type Fence,
    fired,
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
 * The new rules read the same groups through the same matcher as no-restricted-imports (eslint.config.mjs,
 * `matchesGroup`), and the parity table below holds them to it, specifier by specifier.
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
    ]
    const halves: [string, string, Fence, Fence][] = [
        ['keel/core', 'packages/keel/src/core/kv.ts', CORE_STATIC, CORE_DYNAMIC],
        ['the framework/app fence', 'packages/keel/src/server-lib/kv.ts', APP_CODE_STATIC, APP_CODE_DYNAMIC],
        ['the fixture', FIXTURE, APP_CODE_STATIC, APP_CODE_DYNAMIC],
    ]

    describe.each(halves)('%s', (_name, file, staticFence, dynamicFence) => {
        it.each(SPECIFIERS)('%s', async (specifier) => {
            const declared = fired(await lint(file, `import x from '${specifier}'\nexport { x }\n`), staticFence)
            const loaded = fired(await lint(file, `export const load = () => import('${specifier}')\n`), dynamicFence)
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
