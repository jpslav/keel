import { describe, expect, it } from 'vitest'
import {
    A11Y_LITERAL,
    APP,
    fired,
    GET_DB_COMPUTED,
    IMPORTS_VENDOR,
    isIgnored,
    JSX_LITERAL,
    lint,
    LOADS_VENDOR,
    NEXT_FONT,
    PROCESS_ENV,
    REAL_ADAPTER_DYNAMIC,
    RUN_MODE,
    VENDOR_DYNAMIC,
    VENDOR_STATIC,
} from './lint-text'

/**
 * ESLint lints eight extensions in this repo, and the fences in eslint.config.mjs name their zones by
 * directory. They used to name `*.{ts,tsx}` as well, so a `.mjs` file in apps/*\/src, packages/keel/src
 * or keel's test fixture could import a vendor SDK, read process.env or take the raw db handle with a
 * green `pnpm lint`. This file runs the fences across every extension in each zone, and pins that the
 * carve-outs still let through what they were made for, and only that.
 */
const EXTENSIONS = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs']

// A `.cjs` file is CommonJS: Node rejects `import`/`export` in one, though typescript-eslint's parser
// would accept them. So each act is spelled the way a real `.cjs` file can contain it. Its import is
// require(), which keel/no-dynamic-vendor-import sees; no-restricted-imports sees declarations only.
const isCjs = (file: string) => file.endsWith('.cjs')
const importsVendor = (file: string) =>
    isCjs(file) ? "const { S3Client } = require('@aws-sdk/client-s3')\nmodule.exports = S3Client\n" : IMPORTS_VENDOR
const loadsVendor = (file: string) =>
    isCjs(file) ? "module.exports = () => import('@aws-sdk/client-s3')\n" : LOADS_VENDOR
const readsEnv = (file: string) =>
    isCjs(file) ? 'module.exports = process.env.KVS_ARN\n' : 'export const storeArn = process.env.KVS_ARN\n'
const takesRawDb = (file: string) =>
    isCjs(file) ? "module.exports = (db) => db['getDb']()\n" : "export const load = (db) => db['getDb']()\n"

/** Zones both the vendor and process.env bans hold in: an app's src/ and config/, keel's src/, keel's fixture. */
const ZONES = [
    `${APP}/src/app/api/kv/route`,
    `${APP}/src/components/kv-card`,
    `${APP}/src/domain/kv`,
    `${APP}/src/ports/kv`,
    `${APP}/src/adapters/fake/kv`,
    `${APP}/config/mode`,
    'packages/keel/src/server-lib/kv',
    'packages/keel/src/components/kv-panel',
    'packages/keel/test-fixture/domain/kv',
]
/** The ones the tenancy ban holds in as well (./tenancy.test.ts has every form of it). */
const GET_DB_ZONES = [
    `${APP}/src/app/api/kv/route`,
    `${APP}/src/components/kv-card`,
    `${APP}/src/domain/kv`,
    `${APP}/src/jobs/publish-kv`,
    'packages/keel/src/components/kv-panel',
    'packages/keel/test-fixture/api/kv/route',
]

describe('every fence holds for every extension ESLint lints', () => {
    describe.each(ZONES)('%s', (zone) => {
        it.each(EXTENSIONS)('.%s may not import a vendor SDK, statically or dynamically', async (ext) => {
            const file = `${zone}.${ext}`
            // The static form has no CommonJS spelling (see isCjs), so a `.cjs` file reports it as dynamic.
            const statically = await lint(file, importsVendor(file))
            expect(fired(statically, isCjs(file) ? VENDOR_DYNAMIC : VENDOR_STATIC)).toBe(1)
            expect(fired(await lint(file, loadsVendor(file)), VENDOR_DYNAMIC)).toBe(1)
        })

        it.each(EXTENSIONS)('.%s may not read process.env', async (ext) => {
            const file = `${zone}.${ext}`
            expect(fired(await lint(file, readsEnv(file)), PROCESS_ENV)).toBe(1)
        })
    })

    describe.each(GET_DB_ZONES)('%s', (zone) => {
        it.each(EXTENSIONS)('.%s may not take the raw db handle', async (ext) => {
            const file = `${zone}.${ext}`
            expect(fired(await lint(file, takesRawDb(file)), GET_DB_COMPUTED)).toBe(1)
        })
    })

    // The extensions JSX can be written in. `.ts`, `.mts` and `.cts` cannot hold it, and `.cjs` is CommonJS.
    it.each(['tsx', 'jsx', 'js', 'mjs'])('a .%s screen may not hard-code copy', async (ext) => {
        const file = `${APP}/src/components/kv-card.${ext}`
        expect(fired(await lint(file, 'export const Card = () => <p>Saved to the edge</p>\n'), JSX_LITERAL)).toBe(1)
        const label = 'export const Card = () => <button aria-label="Save">x</button>\n'
        expect(fired(await lint(file, label), A11Y_LITERAL)).toBe(1)
    })
})

describe('the carve-outs still let through what they were made for, in every spelling it comes in', () => {
    // Next loads its config from these four names and no other (CONFIG_FILES in next's constants), and
    // the config composes the Sentry build plugin.
    const composesSentry = "import { withSentryConfig } from '@sentry/nextjs'\nexport default withSentryConfig({})\n"

    it.each(['ts', 'mts', 'js', 'mjs'])('next.config.%s may import the Sentry build plugin', async (ext) => {
        const findings = await lint(`${APP}/next.config.${ext}`, composesSentry)
        expect(fired(findings, VENDOR_STATIC) + fired(findings, VENDOR_DYNAMIC)).toBe(0)
    })

    it('a root config Next does not load is fenced like the rest of the app', async () => {
        expect(fired(await lint(`${APP}/next.config.cts`, composesSentry), VENDOR_STATIC)).toBe(1)
        expect(fired(await lint(`${APP}/vite.demo.config.mjs`, composesSentry), VENDOR_STATIC)).toBe(1)
    })

    // The app-root tool configs may read the environment (the Playwright configs do, for ports and modes):
    // the process.env ban covers src/ and config/ only.
    it.each([
        `${APP}/playwright.config.ts`,
        `${APP}/playwright.config.mjs`,
        `${APP}/vite.demo.config.ts`,
        `${APP}/.ladle/config.mjs`,
        `${APP}/postcss.config.cjs`,
    ])('%s may read process.env', async (file) => {
        expect(fired(await lint(file, readsEnv(file)), PROCESS_ENV)).toBe(0)
    })

    it.each(['ts', 'mjs'])('a contract test (.%s) may drive real Postgres', async (ext) => {
        const code = "import pg from 'pg'\nexport const load = () => import('pg')\nexport { pg }\n"
        const findings = await lint(`${APP}/tests/contract/kv.test.${ext}`, code)
        expect(fired(findings, VENDOR_STATIC) + fired(findings, VENDOR_DYNAMIC)).toBe(0)
    })

    describe.each([`${APP}/src/adapters/real/kv`, 'packages/keel/src/adapters/real/kv'])('%s', (zone) => {
        it.each(EXTENSIONS)('.%s may import a vendor SDK and read its own configuration', async (ext) => {
            const file = `${zone}.${ext}`
            for (const code of [importsVendor(file), loadsVendor(file), readsEnv(file)]) {
                const findings = await lint(file, code)
                expect(
                    fired(findings, VENDOR_STATIC) + fired(findings, VENDOR_DYNAMIC) + fired(findings, PROCESS_ENV),
                ).toBe(0)
            }
        })
    })

    it.each(EXTENSIONS)('an app’s real adapter (.%s) still may not read the run mode', async (ext) => {
        const file = `${APP}/src/adapters/real/kv.${ext}`
        const code = isCjs(file)
            ? 'module.exports = process.env.APP_MODE\n'
            : 'export const mode = process.env.APP_MODE\n'
        expect(fired(await lint(file, code), RUN_MODE)).toBe(1)
    })

    // Next looks for its instrumentation hooks under its default pageExtensions, which neither app overrides;
    // they read NEXT_PUBLIC_* by literal name so Next can inline it. A name Next never loads gets no pass.
    it.each(['instrumentation.ts', 'instrumentation.js', 'instrumentation-client.tsx', 'instrumentation-client.jsx'])(
        '%s may read process.env',
        async (name) => {
            expect(fired(await lint(`${APP}/src/${name}`, readsEnv(name)), PROCESS_ENV)).toBe(0)
        },
    )

    it.each(['instrumentation.mjs', 'instrumentation-helpers.ts', 'instrumentation-helpers.tsx'])(
        '%s is not an instrumentation hook, so it may not',
        async (name) => {
            expect(fired(await lint(`${APP}/src/${name}`, readsEnv(name)), PROCESS_ENV)).toBe(1)
        },
    )

    // The two secret readers are exempt by exact file, and a sibling with their name stays fenced.
    it('keel’s two secret readers may read process.env, by exact file', async () => {
        for (const file of ['packages/keel/src/service-auth/webhook.ts', 'packages/keel/src/service-auth/mailgun.ts']) {
            expect(fired(await lint(file, readsEnv(file)), PROCESS_ENV)).toBe(0)
        }
        const sibling = 'packages/keel/src/service-auth/webhook.mjs'
        expect(fired(await lint(sibling, readsEnv(sibling)), PROCESS_ENV)).toBe(1)
    })

    // Tests are what vitest runs (`*.test.{ts,tsx}`); a `.test.mjs` is an ordinary module a route can import.
    it('a test may read process.env, and a .test.mjs is not a test', async () => {
        for (const [file, banned] of [
            [`${APP}/src/domain/kv.test.ts`, 0],
            [`${APP}/src/domain/kv.test.mjs`, 1],
        ] as const) {
            expect(fired(await lint(file, readsEnv(file)), PROCESS_ENV), file).toBe(banned)
        }
    })

    // Stories are what Ladle picks up (`*.stories.{js,jsx,ts,tsx}`), and they render fixtures, not shipped copy.
    it.each(['tsx', 'jsx', 'js'])('a .stories.%s file may use a literal aria-label', async (ext) => {
        const label = 'export const Story = () => <button aria-label="Save">x</button>\n'
        expect(fired(await lint(`${APP}/src/components/kv-card.stories.${ext}`, label), A11Y_LITERAL)).toBe(0)
    })

    // Panda's generated styled-system is ignored, and only what Panda writes there: `.mjs` and `.d.ts`.
    it.each(['css.mjs', 'css.d.ts'])('generated styles (%s) are not linted', async (name) => {
        expect(await isIgnored(`${APP}/src/styles/generated/css/${name}`)).toBe(true)
    })

    it.each(['ts', 'js'])('a hand-written .%s module in the generated directory is fenced', async (ext) => {
        const file = `${APP}/src/styles/generated/css/helper.${ext}`
        expect(fired(await lint(file, readsEnv(file)), PROCESS_ENV)).toBe(1)
    })
})

// What printing the effective config for every zone found besides the two reported holes: blocks that took
// a file set over from an earlier one and dropped part of what it enforced (the merge trap), the registry
// exemption's reach, and two rules whose globs named fewer extensions than ESLint lints.
describe('what the effective-config audit found', () => {
    // The fakes block ignores stories (for the a11y ban), and stories fell back to the process.env block,
    // which never carried the dynamic real/ ban. The static form was banned there all along.
    it.each(['tsx', 'jsx'])('a story beside a fake (.%s) may not load real/ dynamically', async (ext) => {
        const code = "export const load = () => import('../real/kv')\n"
        expect(fired(await lint(`${APP}/src/adapters/fake/kv.stories.${ext}`, code), REAL_ADAPTER_DYNAMIC)).toBe(1)
    })

    // ...and keeps the process.env ban that block re-lists for it.
    it.each(['tsx', 'jsx'])('a story beside a fake (.%s) may not read process.env', async (ext) => {
        const file = `${APP}/src/adapters/fake/kv.stories.${ext}`
        expect(fired(await lint(file, readsEnv(file)), PROCESS_ENV)).toBe(1)
    })

    // The registry is `adapters/index.ts` by name; an `index.mjs` beside it is one more module.
    it.each(['index.mjs', 'index.js'])('adapters/%s may not load real/', async (name) => {
        const code = "export const load = () => import('./real/kv')\n"
        expect(fired(await lint(`${APP}/src/adapters/${name}`, code), REAL_ADAPTER_DYNAMIC)).toBe(1)
    })

    // keel/core's block replaced the framework fence and listed no font pattern; its own `next/*` group
    // caught the import under core's message instead.
    it('keel/core may not import next/font/google, and is told why', async () => {
        const code = "import { Inter } from 'next/font/google'\nexport const font = Inter\n"
        expect(fired(await lint('packages/keel/src/core/kv.ts', code), NEXT_FONT)).toBe(1)
    })

    it.each(['mts', 'cts'])('keel’s public surface holds in a .%s file', async (ext) => {
        const code = "import { x } from 'keel/not-a-published-subpath'\nexport { x }\n"
        const findings = await lint(`scripts/thing.${ext}`, code)
        expect(findings.filter((f) => f.rule === 'keel/public-surface')).toHaveLength(1)
    })

    // Playwright's default testMatch picks up `.spec.mjs` and `.test.js`, and a support helper can be either.
    it.each(['tests/e2e/kv.spec.mjs', 'tests/e2e/support/scratch.js'])(
        'a raw mkdtemp in %s is caught',
        async (file) => {
            const code = "import { mkdtempSync } from 'node:fs'\nexport const dir = mkdtempSync('x')\n"
            const findings = await lint(`${APP}/${file}`, code)
            expect(findings.filter((f) => f.rule === 'keel/no-direct-mkdtemp')).toHaveLength(1)
        },
    )
})
