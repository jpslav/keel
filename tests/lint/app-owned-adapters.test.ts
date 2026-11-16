import path from 'node:path'
import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The app-owned adapter seam (ADR-0012, addendum 2026-11-16) is a set of lint fences, and this file
 * pins them against the repo's REAL config: `new ESLint()` with no override, linting virtual files at
 * the paths the fences are about. Nothing is written to disk, so there is no dead fixture for knip,
 * tsc or jscpd to trip over, and no vendor package has to be installed. `no-restricted-imports`
 * judges the specifier and never resolves it.
 *
 * The paths sit under `apps/any-app/`, which is neither of this repo's apps, on purpose. Every fence
 * is written `apps/*`, so the app's name is not what is being tested, and a name nobody owns
 * survives `pnpm init-app` renaming or ejecting the real ones.
 */
const repoRoot = process.cwd()
const APP = 'apps/any-app'

let eslint: ESLint
beforeAll(() => {
    eslint = new ESLint({ cwd: repoRoot })
})

interface Finding {
    rule: string
    message: string
}

async function lint(relativePath: string, code: string): Promise<Finding[]> {
    const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, relativePath) })
    // A parse failure, or the warning for a file the config ignores, carries no rule id. Either one
    // would make every "nothing fired" expectation below pass vacuously, so it fails the case instead.
    expect(
        result.messages.filter((m) => !m.ruleId),
        `${relativePath} was not actually linted`,
    ).toEqual([])
    return result.messages.map((m) => ({ rule: m.ruleId as string, message: m.message }))
}

// Each fence is told apart by its rule id AND its message, because three different patterns all
// report as `no-restricted-imports` and two different selectors as `no-restricted-syntax`.
const VENDOR_STATIC = { rule: 'no-restricted-imports', fragment: 'Vendor SDKs may only be imported' }
const VENDOR_DYNAMIC = { rule: 'keel/no-dynamic-vendor-import', fragment: 'is a vendor SDK' }
const PROCESS_ENV = { rule: 'no-restricted-syntax', fragment: 'process.env is read ONLY' }
const RUN_MODE = { rule: 'no-restricted-syntax', fragment: "Run mode is keel's" }
const REAL_ADAPTER = { rule: 'no-restricted-imports', fragment: "Reach the app's real adapters through its registry" }
const REAL_ADAPTER_INSIDE = { rule: 'no-restricted-imports', fragment: 'real/ is loaded only with import()' }
const NEXT_FONT = { rule: 'no-restricted-imports', fragment: 'next/font/google phones home' }
const JSX_LITERAL = { rule: 'react/jsx-no-literals', fragment: '' }
const A11Y_LITERAL = {
    rule: 'no-restricted-syntax',
    fragment: 'aria-label/placeholder/title/alt carry user-visible copy',
}

type Fence = typeof VENDOR_STATIC
const fired = (findings: Finding[], fence: Fence) =>
    findings.filter((f) => f.rule === fence.rule && f.message.includes(fence.fragment)).length

const IMPORTS_VENDOR = "import { S3Client } from '@aws-sdk/client-s3'\nexport const client = S3Client\n"
const IMPORTS_VENDOR_SUBPATH = "import { auth } from '@clerk/nextjs/server'\nexport const current = auth\n"
const LOADS_VENDOR = "export const load = () => import('@aws-sdk/client-s3')\n"
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
    ])('a real adapter may not read the run mode itself (%s)', async (_form, code) => {
        expect(fired(await lint(`${APP}/src/adapters/real/kv.ts`, code), RUN_MODE)).toBe(1)
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
        [`${APP}/src/adapters/server.ts`, './real/index'],
    ])('%s may not statically import %s', async (file, specifier) => {
        const findings = await lint(file, `import { kv } from '${specifier}'\nexport const store = kv\n`)
        expect(fired(findings, REAL_ADAPTER_INSIDE)).toBe(1)
    })

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
    it.each([`${APP}/src/adapters/real/kv-widget.tsx`, 'packages/keel/src/adapters/real/kv-widget.tsx'])(
        '%s may not hard-code copy',
        async (file) => {
            const text = 'export const Widget = () => <p>Saved to the edge</p>\n'
            expect(fired(await lint(file, text), JSX_LITERAL)).toBe(1)
            const label = 'export const Widget = () => <button aria-label="Save">x</button>\n'
            expect(fired(await lint(file, label), A11Y_LITERAL)).toBe(1)
        },
    )
})
