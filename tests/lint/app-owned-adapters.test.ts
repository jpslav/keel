import { describe, expect, it } from 'vitest'
import {
    A11Y_LITERAL,
    APP,
    fired,
    IMPORTS_VENDOR,
    JSX_LITERAL,
    KEEL_REAL_ADAPTER,
    lint,
    LOADS_VENDOR,
    NEXT_FONT,
    PROCESS_ENV,
    REAL_ADAPTER,
    REAL_ADAPTER_DYNAMIC,
    REAL_ADAPTER_INSIDE,
    RUN_MODE,
    VENDOR_DYNAMIC,
    VENDOR_STATIC,
} from './lint-text'

/**
 * The app-owned adapter seam (ADR-0012, addendum 2026-11-16) is a set of lint fences, and this file
 * pins them against the repo's REAL config (./lint-text says how, and why the app is `apps/any-app`).
 * Every case here is a `.ts` or `.tsx` file; ./extensions.test.ts holds the same fences for the other
 * six extensions ESLint lints.
 */
const IMPORTS_VENDOR_SUBPATH = "import { auth } from '@clerk/nextjs/server'\nexport const current = auth\n"
const LOADS_VENDOR_TEMPLATE = 'export const load = () => import(`pg`)\n'

/** The only two places a vendor SDK may be imported. */
const VENDOR_ZONES = [
    `${APP}/src/adapters/real/kv.ts`,
    `${APP}/src/adapters/real/signing/sigv4a.ts`,
    `${APP}/src/adapters/real/kv.test.ts`,
    'packages/keel/src/adapters/real/kv.ts',
]

/** Everywhere else it is banned — the app's own registry and fakes included. */
const OUTSIDE_VENDOR_ZONES = [
    // the app's registry and fake: what keeps `pnpm dev` hermetic, so vendor-free by construction
    `${APP}/src/adapters/index.ts`,
    `${APP}/src/adapters/fake/kv.ts`,
    `${APP}/src/adapters/fake/kv.test.ts`,
    // the app's port, and everything that codes against it
    `${APP}/src/ports/kv.ts`,
    `${APP}/src/domain/kv.ts`,
    `${APP}/src/jobs/publish-kv.ts`,
    `${APP}/src/app/api/kv/route.ts`,
    `${APP}/src/app/[locale]/kv/page.tsx`,
    `${APP}/src/components/kv-card.tsx`,
    `${APP}/src/app-config/jobs.ts`,
    `${APP}/src/demo-static/app.tsx`,
    `${APP}/config/params.ts`,
    // a lookalike: an `adapters/real` that is not the app's adapters directory
    `${APP}/src/domain/adapters/real/kv.ts`,
    // keel outside its own adapters, and keel's fixture even at an adapters-shaped path
    'packages/keel/src/server-lib/kv.ts',
    'packages/keel/test-fixture/domain/kv.ts',
    'packages/keel/test-fixture/adapters/real/kv.ts',
]

describe('vendor SDKs: only keel adapters and an app’s real adapters may import one', () => {
    it.each(VENDOR_ZONES)('%s may import a vendor SDK, statically or dynamically', async (file) => {
        for (const code of [IMPORTS_VENDOR, IMPORTS_VENDOR_SUBPATH, LOADS_VENDOR, LOADS_VENDOR_TEMPLATE]) {
            const findings = await lint(file, code)
            expect(fired(findings, VENDOR_STATIC) + fired(findings, VENDOR_DYNAMIC), code).toBe(0)
        }
    })

    it.each(OUTSIDE_VENDOR_ZONES)('%s may not import a vendor SDK statically', async (file) => {
        expect(fired(await lint(file, IMPORTS_VENDOR), VENDOR_STATIC)).toBe(1)
        expect(fired(await lint(file, IMPORTS_VENDOR_SUBPATH), VENDOR_STATIC)).toBe(1)
    })

    it.each(OUTSIDE_VENDOR_ZONES)('%s may not import a vendor SDK dynamically', async (file) => {
        expect(fired(await lint(file, LOADS_VENDOR), VENDOR_DYNAMIC)).toBe(1)
        expect(fired(await lint(file, LOADS_VENDOR_TEMPLATE), VENDOR_DYNAMIC)).toBe(1)
    })

    it('a deep subpath of a scoped vendor package is still the vendor', async () => {
        const code = "export const load = () => import('@clerk/nextjs/server')\n"
        expect(fired(await lint(`${APP}/src/domain/kv.ts`, code), VENDOR_DYNAMIC)).toBe(1)
    })

    it('a test loading the real vendor module with vi.importActual is importing it', async () => {
        const code = "import { vi } from 'vitest'\nexport const load = () => vi.importActual('pg')\n"
        expect(fired(await lint(`${APP}/src/domain/kv.test.ts`, code), VENDOR_DYNAMIC)).toBe(1)
    })

    it('require() is the same import as import()', async () => {
        const code = "export const load = () => require('pg')\n"
        expect(fired(await lint(`${APP}/src/domain/kv.ts`, code), VENDOR_DYNAMIC)).toBe(1)
        expect(fired(await lint(`${APP}/src/adapters/real/kv.ts`, code), VENDOR_DYNAMIC)).toBe(0)
    })

    it('reads the vendor list, not a prefix of it: pg-boss, pglite and a local ./pg are not vendor SDKs', async () => {
        const code = [
            "export const a = () => import('pg-boss')",
            "export const b = () => import('@electric-sql/pglite')",
            "export const c = () => import('./pg')",
        ].join('\n')
        expect(fired(await lint(`${APP}/src/domain/kv.ts`, code), VENDOR_DYNAMIC)).toBe(0)
    })
})

describe('process.env: an app’s real adapters read their own configuration, never the run mode', () => {
    it('a real adapter may read its own configuration', async () => {
        const findings = await lint(`${APP}/src/adapters/real/kv.ts`, 'export const storeArn = process.env.KVS_ARN\n')
        expect(fired(findings, PROCESS_ENV) + fired(findings, RUN_MODE)).toBe(0)
    })

    it.each([
        ['dot access', 'export const mode = process.env.APP_MODE\n'],
        ['computed access', "export const demo = process.env['DEMO_MODE']\n"],
        ['destructuring', 'const { E2E_BUILD } = process.env\nexport const e2e = E2E_BUILD\n'],
        ['template-literal access', 'export const mode = process.env[`APP_MODE`]\n'],
        ['a quoted destructuring key', "const { 'APP_MODE': mode } = process.env\nexport { mode }\n"],
        ['destructuring assignment', 'let mode\n;({ APP_MODE: mode } = process.env)\nexport { mode }\n'],
        ['a parameter default', 'export function mode({ DEMO_MODE } = process.env) {\n    return DEMO_MODE\n}\n'],
        ['a template-literal destructuring key', 'const { [`APP_MODE`]: mode } = process.env\nexport { mode }\n'],
        // `env` itself spelled as a key: the same object, so the same ban
        ['env as a quoted key', "export const mode = process['env'].APP_MODE\n"],
        ['env as a template-literal key', 'export const mode = process[`env`][`DEMO_MODE`]\n'],
        ['destructuring env as a quoted key', "const { E2E_BUILD } = process['env']\nexport const e2e = E2E_BUILD\n"],
    ])('a real adapter may not read the run mode itself (%s)', async (_form, code) => {
        expect(fired(await lint(`${APP}/src/adapters/real/kv.ts`, code), RUN_MODE)).toBe(1)
    })

    it('a story beside a real adapter may not read the run mode either', async () => {
        const code = 'export const mode = process.env.APP_MODE\n'
        expect(fired(await lint(`${APP}/src/adapters/real/kv-widget.stories.tsx`, code), RUN_MODE)).toBe(1)
    })

    it('importing from node:process for anything but env is not reading process.env', async () => {
        const code =
            "import { cwd } from 'node:process'\nimport type { Foo } from 'process'\nexport const here = cwd\nexport type F = Foo\n"
        expect(fired(await lint(`${APP}/src/domain/kv.ts`, code), PROCESS_ENV)).toBe(0)
    })

    it('a real adapter’s own test may set the run mode', async () => {
        const code = "process.env.APP_MODE = 'real'\nexport const mode = process.env.APP_MODE\n"
        expect(fired(await lint(`${APP}/src/adapters/real/kv.test.ts`, code), RUN_MODE)).toBe(0)
    })

    it.each([
        `${APP}/src/adapters/index.ts`,
        `${APP}/src/adapters/fake/kv.ts`,
        `${APP}/src/ports/kv.ts`,
        `${APP}/src/domain/kv.ts`,
        // the directory beside src/: a helper here could otherwise hand the registry its own reading of APP_MODE
        `${APP}/config/mode.ts`,
        `${APP}/config/params.ts`,
    ])('%s may not read process.env at all', async (file) => {
        expect(fired(await lint(file, 'export const storeArn = process.env.KVS_ARN\n'), PROCESS_ENV)).toBe(1)
        // the same name spelled as a key
        expect(fired(await lint(file, "export const storeArn = process['env'].KVS_ARN\n"), PROCESS_ENV)).toBe(1)
        expect(fired(await lint(file, 'export const storeArn = process[`env`].KVS_ARN\n'), PROCESS_ENV)).toBe(1)
        // the same object under another name
        const imported = "import { env } from 'node:process'\nexport const storeArn = env.KVS_ARN\n"
        expect(fired(await lint(file, imported), PROCESS_ENV)).toBe(1)
    })

    // A template key is the name only when it has no expressions; `env${x}` could be anything.
    it('a template key with an expression in it is not the name', async () => {
        const notEnv = 'const x = 1\nexport const v = process[`env${x}`]\n'
        expect(fired(await lint(`${APP}/src/domain/kv.ts`, notEnv), PROCESS_ENV)).toBe(0)
        const notRunMode = 'const x = 1\nexport const m = process.env[`APP_MODE${x}`]\n'
        expect(fired(await lint(`${APP}/src/adapters/real/kv.ts`, notRunMode), RUN_MODE)).toBe(0)
    })
})

describe('an app’s real adapters are reached through its registry', () => {
    it.each([
        [`${APP}/src/domain/kv.ts`, '@/adapters/real/kv'],
        [`${APP}/src/domain/kv.ts`, '../adapters/real/kv'],
        [`${APP}/src/app/api/kv/route.ts`, '../../../adapters/real/kv'],
        [`${APP}/src/app-config/jobs.ts`, '@/adapters/real'],
        [`${APP}/src/components/kv-card.tsx`, '@/adapters/real/kv-widget'],
        [`${APP}/src/jobs/publish-kv.ts`, '@/adapters/real/index'],
    ])('%s may not statically import %s', async (file, specifier) => {
        const findings = await lint(file, `import { kv } from '${specifier}'\nexport const store = kv\n`)
        expect(fired(findings, REAL_ADAPTER)).toBe(1)
    })

    it('the registry loads real/ with import(), behind isSimulated', async () => {
        const code = [
            "import { isSimulated } from 'keel/adapters/index'",
            "import { fakeKv } from './fake/kv'",
            "const real = isSimulated ? null : (await import('./real/index')).createRealAppPorts()",
            'export const kv = real?.kv ?? fakeKv',
        ].join('\n')
        const findings = await lint(`${APP}/src/adapters/index.ts`, code)
        expect(fired(findings, REAL_ADAPTER) + fired(findings, REAL_ADAPTER_INSIDE)).toBe(0)
    })

    // Inside the adapters directory a static import of real/ would load the vendor SDK in simulated mode:
    // from the registry, in every mode; from a fake, into the very thing that keeps `pnpm dev` hermetic.
    it.each([
        [`${APP}/src/adapters/index.ts`, './real/kv'],
        [`${APP}/src/adapters/index.ts`, './real'],
        [`${APP}/src/adapters/fake/kv.ts`, '../real/kv'],
        [`${APP}/src/adapters/fake/kv.ts`, '@/adapters/real/kv'],
        [`${APP}/src/adapters/fake/edge/kv.ts`, '../../real/kv'],
        [`${APP}/src/adapters/server.ts`, './real/index'],
    ])('%s may not statically import %s', async (file, specifier) => {
        const findings = await lint(file, `import { kv } from '${specifier}'\nexport const store = kv\n`)
        expect(fired(findings, REAL_ADAPTER_INSIDE)).toBe(1)
    })

    // ...and only the registry may load it dynamically: a fake, or a second module beside the registry,
    // doing the registry's own import() would load the vendor without asking the run mode.
    it.each([
        [
            `${APP}/src/adapters/fake/kv.ts`,
            "export const kv = async () => (await import('../real/kv')).createRealKv()\n",
        ],
        [`${APP}/src/adapters/fake/kv.ts`, 'export const kv = () => import(`../real/kv`)\n'],
        [`${APP}/src/adapters/server.ts`, "export const ports = () => import('./real/index')\n"],
    ])('%s may not load real/ dynamically either', async (file, code) => {
        expect(fired(await lint(file, code), REAL_ADAPTER_DYNAMIC)).toBe(1)
    })

    it.each([`${APP}/src/adapters/fake/kv.ts`, `${APP}/src/adapters/index.ts`])(
        '%s may not statically import one of keel’s published real adapters',
        async (file) => {
            const code = "import { createRealLlm } from 'keel/adapters/real/llm'\nexport const make = createRealLlm\n"
            expect(fired(await lint(file, code), KEEL_REAL_ADAPTER)).toBe(1)
        },
    )

    it('inside real/, adapters import each other freely', async () => {
        const code =
            "import { sign } from './signing/sigv4a'\nimport { createRealKv } from './kv'\nexport { sign, createRealKv }\n"
        const findings = await lint(`${APP}/src/adapters/real/index.ts`, code)
        expect(fired(findings, REAL_ADAPTER) + fired(findings, REAL_ADAPTER_INSIDE)).toBe(0)
    })

    it('a page may reach a real-mode-only component by dynamic import, as it reaches keel’s', async () => {
        const code = [
            "import { isSimulated } from 'keel/adapters/index'",
            "import { RealSignInForm } from 'keel/adapters/real/sign-in-form'",
            "import { kv } from '@/adapters'",
            "import { live } from '@/adapters/realtime'",
            "export const widget = () => (isSimulated ? null : import('@/adapters/real/kv-widget'))",
            'export { RealSignInForm, kv, live }',
        ].join('\n')
        expect(fired(await lint(`${APP}/src/app/[locale]/kv/page.tsx`, code), REAL_ADAPTER)).toBe(0)
    })
})

// The merge trap (eslint.config.mjs, top): a later no-restricted-imports block REPLACES an earlier one
// for the files it matches, and the app's adapters directory now has two blocks of its own. Each must
// re-list the hermetic-dev font ban or it silently disappears there.
describe('the hermetic-dev font ban survives in every app-owned adapter block', () => {
    it.each([`${APP}/src/adapters/index.ts`, `${APP}/src/adapters/fake/kv.ts`, `${APP}/src/adapters/real/kv.ts`])(
        '%s may not import next/font/google',
        async (file) => {
            const code = "import { Inter } from 'next/font/google'\nexport const font = Inter\n"
            expect(fired(await lint(file, code), NEXT_FONT)).toBe(1)
        },
    )
})

// A real-mode-only component (a vendor's widget) lives in real/ and renders copy, so the i18n rules that
// govern every other screen follow it there — and into keel's adapters, where the real sign-in form lives.
describe('copy in an adapter’s component goes through next-intl', () => {
    it.each([
        `${APP}/src/adapters/real/kv-widget.tsx`,
        `${APP}/src/adapters/fake/kv-widget.tsx`,
        'packages/keel/src/adapters/real/kv-widget.tsx',
    ])('%s may not hard-code copy', async (file) => {
        const text = 'export const Widget = () => <p>Saved to the edge</p>\n'
        expect(fired(await lint(file, text), JSX_LITERAL)).toBe(1)
        const label = 'export const Widget = () => <button aria-label="Save">x</button>\n'
        expect(fired(await lint(file, label), A11Y_LITERAL)).toBe(1)
    })

    it('a story beside an adapter component renders fixtures, not shipped copy, as stories do elsewhere', async () => {
        const label = 'export const Story = () => <button aria-label="Save">x</button>\n'
        expect(fired(await lint(`${APP}/src/adapters/real/kv-widget.stories.tsx`, label), A11Y_LITERAL)).toBe(0)
    })
})
