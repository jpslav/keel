import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import js from '@eslint/js'
import nextPlugin from '@next/eslint-plugin-next'
import prettierConfig from 'eslint-config-prettier'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import typescriptEslint from 'typescript-eslint'

// Shared by the boundary blocks below. NOTE: eslint rule config merges by OBJECT KEY — a later
// block's 'no-restricted-imports' REPLACES an earlier one for matching files. Any block that
// re-declares the rule must include these vendor patterns again, or the boundary silently
// disappears for those files (this bit us for keel/core).
const vendorSdkPattern = {
    group: [
        '@clerk/*',
        '@aws-sdk/*',
        '@anthropic-ai/*',
        '@sentry/*',
        'posthog-js',
        'posthog-js/*',
        'posthog-node',
        'mailgun.js',
        'mailgun.js/*',
        'pg',
        'pg/*',
    ],
    message:
        'Vendor SDKs may only be imported inside packages/keel/src/adapters/ — code against the port in keel/ports/ instead (see CONTRIBUTING.md).',
}

// The framework/app FENCE (ADR-0012). The framework IS a package (packages/keel), so
// the fence is a package boundary: nothing inside it may reach the host app's code. The app's `@/*`
// alias still resolves from anywhere in the repo (tsconfig paths are global), so it is banned wholesale
// here — one pattern instead of a per-directory list — along with the app's seed package. The
// `@app-config/*` alias is the one sanctioned door; note it is DELIBERATELY distinct from `@/app-config/*`
// so the fenced form stays bannable.
//
// MERGE TRAP (see the vendorSdkPattern note): a later no-restricted-imports block REPLACES an earlier
// one for matching files, so every framework block re-lists BOTH vendorSdkPattern AND appCodePattern.
const appCodePattern = {
    group: ['@/*', '@app/seed', '@app/seed/*'],
    message:
        'Framework code (packages/keel) must reach app content only through the seam — import from the ' +
        "@app-config/* alias (apps/*/src/app-config/*), never the app's @/* alias or @app/seed (ADR-0012).",
}

// Shared no-restricted-syntax selectors (merge trap applies to this rule too — a later block replaces
// an earlier one per matching file, so blocks that need both re-list both).
// These aim at the ACT — naming `getDb` — rather than one syntactic shape of it, because
// shape-matching was bypassed twice. They do NOT catch every indirection and cannot: a variable key
// (`const k = 'getDb' as const; db[k]()`) still walks past them, and no lint rule can chase an
// arbitrary alias. The real boundary is RLS in the database; this is a fast, local reminder.
//
// The history is why they look like this: a call-expression selector missed `const { getDb } = db`,
// and adding a destructuring selector still left `db.getDb.bind(db)`, `db['getDb']()` and
// destructuring in a function PARAMETER. So the MemberExpression form subsumes the original call
// form, and the ObjectPattern form deliberately carries no `VariableDeclarator >` ancestor, which is
// what makes a destructured parameter count.
const getDbSelector = {
    selector: 'MemberExpression[property.name="getDb"]',
    message:
        'Route/UI code must not use the raw db handle — use db.withTenant() (or a keel/db helper) so RLS tenant context is set (ADR-0004).',
}
const getDbComputedSelector = {
    selector: 'MemberExpression[computed=true][property.value="getDb"]',
    message:
        "Reaching the raw db handle as db['getDb'] bypasses the same rule — use db.withTenant() (or a keel/db helper) so RLS tenant context is set (ADR-0004).",
}
const getDbDestructureSelector = {
    selector: 'ObjectPattern > Property[key.name="getDb"]',
    message:
        'Destructuring getDb out of the db port bypasses the same rule — use db.withTenant() (or a keel/db helper) so RLS tenant context is set (ADR-0004).',
}
const processEnvSelector = {
    selector: 'MemberExpression[object.name="process"][property.name="env"]',
    message:
        'process.env is read ONLY inside packages/keel/src/adapters (CLAUDE.md) — deployment/service params ' +
        'come from the app config/params.ts, run mode from keel/adapters (isSimulated/isDemoMode). Secret ' +
        'readers are exempted per-file in eslint.config.mjs.',
}
// Hermetic dev (CLAUDE.md): next/font/google fetches from Google Fonts at build — banned so pnpm dev
// never phones home. Self-host via next/font/local instead. Re-listed in every framework no-restricted-
// imports block (merge trap).
const nextFontPattern = {
    group: ['next/font/google', 'next/font/google/*'],
    message:
        'next/font/google phones home to Google Fonts at build — banned to keep dev hermetic (CLAUDE.md); use next/font/local.',
}
// i18n (ADR-0008): these attributes carry user-visible copy, which react/jsx-no-literals can't see
// (ignoreProps:true). Route them through next-intl (a t() call), never a string literal. Stories are
// carved out (they render fixtures, not shipped UI).
const a11yLiteralSelector = {
    selector: "JSXAttribute[name.name=/^(aria-label|placeholder|title|alt)$/][value.type='Literal']",
    message:
        'aria-label/placeholder/title/alt carry user-visible copy — route them through next-intl (t()), never a string literal (ADR-0008).',
}

// The framework package (ADR-0012) — hoisted so the boundary blocks below read as one line each
// instead of a per-directory list. UI_GLOBS is every screen/route file, on BOTH sides of the line: the
// app's routes and cards plus the framework's screens, which the same UI rules (getDb, process.env,
// i18n literals, a11y attributes) must keep covering now that they live in the package.
const FRAMEWORK_FILES_GLOB = 'packages/keel/src/**/*.{ts,tsx}'
const FRAMEWORK_COMPONENTS_GLOB = 'packages/keel/src/components/**/*.{ts,tsx}'
const UI_GLOBS = ['apps/*/src/app/**/*.{ts,tsx}', 'apps/*/src/components/**/*.{ts,tsx}', FRAMEWORK_COMPONENTS_GLOB]

// keel's OWN app seam (ADR-0012): packages/keel/test-fixture is app-SHAPED code that lives
// inside the framework package, and it is the seam the root program resolves `@app-config/*` through.
// It is NOT under src/, and every glob above says `src/`, so it started life outside every boundary
// block in this file — the one directory in packages/keel where importing an app's `@/*` alias or
// `@app/seed` was legal. A type-only import there is erased at runtime and the root tsc resolves `@/*`
// program-wide, so it would have passed lint, typecheck AND vitest, and broken only at
// `pnpm init-app --eject-showcase` — the exact failure the fixture exists to remove. It is therefore
// named explicitly wherever a rule is about a FRAMEWORK invariant. See the fixture blocks below for
// which rules apply and which deliberately do not.
const FIXTURE_FILES_GLOB = 'packages/keel/test-fixture/**/*.{ts,tsx}'

// ---------------------------------------------------------------------------------------------
// keel's PUBLIC SURFACE (ADR-0012).
//
// The package `exports` map names the 130 subpaths an app may import (128 modules + the two message
// catalogs); the other 35 modules under `src/` are internals reachable only by relative import inside
// packages/keel. Both halves are derived, not remembered — `node -e` over the map and a walk of
// `src/**` minus `*.test.*`/`*.stories.*`; recount rather than adjust. But the repo ALIASES `keel` to source in
// tsconfig paths, both vitest configs and each app's vite build, and an alias bypasses the exports
// map entirely — so on its own the map is a comment, not a boundary. This rule is the boundary: it
// reads the SAME exports map (single source of truth — there is no second list to drift) and fails
// any `keel/<subpath>` specifier the map does not publish.
//
// Deliberately NOT expressed as `no-restricted-imports` patterns: that rule's config merges by key,
// so a later block replaces an earlier one for matching files (the merge trap documented above), and
// this fence must hold for EVERY file in the repo. Its own rule id can't be clobbered.
const keelExports = JSON.parse(readFileSync(join(import.meta.dirname, 'packages/keel/package.json'), 'utf8')).exports
const publicSubpaths = new Set()
const publicPatterns = []
for (const [key, target] of Object.entries(keelExports)) {
    // `null` targets are explicit denials, and `.`/`./package.json` are not module subpaths.
    if (target === null || key === '.' || key === './package.json') continue
    const subpath = key.replace(/^\.\//, '')
    if (subpath.includes('*')) {
        const [prefix, suffix] = subpath.split('*')
        publicPatterns.push({ prefix, suffix })
    } else {
        publicSubpaths.add(subpath)
    }
}
const isPublicKeelSpecifier = (specifier) => {
    const subpath = specifier.slice('keel/'.length)
    if (publicSubpaths.has(subpath)) return true
    return publicPatterns.some(
        ({ prefix, suffix }) =>
            subpath.length >= prefix.length + suffix.length && subpath.startsWith(prefix) && subpath.endsWith(suffix),
    )
}

/** @type {import('eslint').Rule.RuleModule} */
const keelPublicSurfaceRule = {
    meta: {
        type: 'problem',
        docs: {
            description: "Only keel's published subpaths (packages/keel/package.json `exports`) may be imported.",
        },
        schema: [],
        messages: {
            private:
                "`{{specifier}}` is not part of keel's public surface — it is an internal of packages/keel, " +
                'reachable only by relative import inside the package. Import a published subpath ' +
                '(packages/keel/package.json `exports`) instead, or promote this module by adding it there ' +
                'if it is genuinely part of the contract (ADR-0012).',
        },
    },
    create(context) {
        const check = (node) => {
            const value = node?.value
            if (typeof value !== 'string' || !value.startsWith('keel/')) return
            if (isPublicKeelSpecifier(value)) return
            context.report({ node, messageId: 'private', data: { specifier: value } })
        }
        return {
            ImportDeclaration: (node) => check(node.source),
            ImportExpression: (node) => check(node.source),
            ExportAllDeclaration: (node) => check(node.source),
            ExportNamedDeclaration: (node) => check(node.source),
            'CallExpression[callee.name="require"]': (node) => check(node.arguments[0]),
            // vitest/jest mock a module by specifier, which resolves exactly like an import.
            'CallExpression[callee.object.name=/^(vi|jest)$/][callee.property.name=/^(mock|doMock|unmock|importActual|importMock)$/]':
                (node) => check(node.arguments[0]),
        }
    },
}

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
    {
        ignores: [
            '**/node_modules/**',
            '**/.next/**',
            '**/.data/**',
            'out/**',
            'build/**',
            'dist/**',
            '**/next-env.d.ts',
            '.*',
            '!.ladle',
            '!.ladle/**',
            '**/.ladle/dist/**',
            'apps/*/src/styles/generated/**',
            '**/test-results/**',
            '**/playwright-report/**',
            '**/coverage/**',
            'spikes/*/node_modules/**',
            'infra/cdk.out/**',
            '**/dist-demo/**',
        ],
    },
    js.configs.recommended,
    ...typescriptEslint.configs.recommended,
    {
        files: ['**/*.cjs'],
        languageOptions: {
            sourceType: 'commonjs',
            globals: { module: 'writable', require: 'readonly', __dirname: 'readonly', process: 'readonly' },
        },
    },
    {
        files: ['scripts/**/*.{mjs,ts}'],
        languageOptions: {
            globals: { process: 'readonly', console: 'readonly' },
        },
    },
    // Kysely migrations are conventionally typed Kysely<any> (schema evolves under them), and
    // spikes are proof harnesses — relax the any ban there only.
    {
        files: ['**/migrations/**/*.ts', 'spikes/**/*.ts'],
        rules: { '@typescript-eslint/no-explicit-any': 'off' },
    },
    {
        files: ['**/*.{js,jsx,ts,tsx}'],
        plugins: {
            react: reactPlugin,
            'react-hooks': reactHooksPlugin,
            'jsx-a11y': jsxA11y,
        },
        rules: {
            ...reactPlugin.configs.recommended.rules,
            ...reactPlugin.configs['jsx-runtime'].rules,
            ...reactHooksPlugin.configs.recommended.rules,
            ...jsxA11y.configs.recommended.rules,
            'react/prop-types': 'off',
        },
        settings: {
            // Explicit version: eslint-plugin-react's 'detect' path uses context.getFilename,
            // which ESLint 10 removed. Bump alongside React upgrades.
            react: { version: '19.2' },
        },
    },
    {
        files: ['apps/*/src/**/*.{ts,tsx}', 'packages/keel/src/**/*.{ts,tsx}'],
        plugins: { '@next/next': nextPlugin },
        rules: {
            ...nextPlugin.configs.recommended.rules,
        },
    },
    // tenancy: request-path code must not grab the raw db handle — tenant-scoped access goes
    // through withTenant so RLS context is always set (ADR-0004). App/component TEST files keep the
    // getDb ban but are exempt from the process.env ban (they set APP_DATA_DIR for isolation).
    {
        files: UI_GLOBS,
        rules: {
            'no-restricted-syntax': ['error', getDbSelector, getDbComputedSelector, getDbDestructureSelector],
        },
    },
    // params centralization (CLAUDE.md): process.env is read ONLY inside keel's adapters — every other module
    // imports the resolved value (the app's config/params.ts for deployment params; isSimulated/isDemoMode
    // from keel/adapters for run mode). Exempt: adapters, instrumentation (NEXT_PUBLIC needs literal inlining),
    // the two secret readers, and test files (which set APP_DATA_DIR for isolation). App/component
    // non-test files also get the ban — re-listing getDbSelector so their getDb ban survives the merge.
    {
        files: UI_GLOBS,
        ignores: ['**/*.test.{ts,tsx}'],
        rules: {
            'no-restricted-syntax': [
                'error',
                getDbSelector,
                getDbComputedSelector,
                getDbDestructureSelector,
                processEnvSelector,
            ],
        },
    },
    // Targeted a11y-attribute literal ban (ADR-0008): non-test, non-story app/component code. Re-lists the
    // getDb + process.env selectors (merge trap) so this block, being last for a regular component,
    // still enforces them. Stories render fixtures, not shipped UI, so they are carved out.
    {
        files: UI_GLOBS,
        ignores: ['**/*.test.{ts,tsx}', '**/*.stories.tsx'],
        rules: {
            'no-restricted-syntax': [
                'error',
                getDbSelector,
                getDbDestructureSelector,
                processEnvSelector,
                a11yLiteralSelector,
            ],
        },
    },
    {
        files: ['apps/*/src/**/*.{ts,tsx}', 'packages/keel/src/**/*.{ts,tsx}'],
        ignores: [
            'apps/*/src/app/**',
            'apps/*/src/components/**',
            'packages/keel/src/components/**',
            'packages/keel/src/adapters/**',
            'apps/*/src/instrumentation*.ts',
            'packages/keel/src/service-auth/webhook.ts',
            'packages/keel/src/service-auth/mailgun.ts',
            '**/*.test.{ts,tsx}',
        ],
        rules: {
            'no-restricted-syntax': ['error', processEnvSelector],
        },
    },
    // Same tenancy ban as UI_GLOBS, wider net — and it MUST come after the process.env block above,
    // which matches `apps/*/src/**` and so replaced an earlier getDb block for these files outright.
    // That is the merge trap this file documents at the top, walked into once while adding this rule:
    // the ban silently did nothing, and only `--print-config` showed why. It re-lists BOTH selectors
    // for the same reason every other block here does.
    //
    // WHY these directories: an app's domain/ and jobs/ are request-path code. The module a route calls
    // to run the query is likelier to reach for the raw handle than the route itself, and CLAUDE.md
    // sends adopters to `apps/showcase/src/domain/db/tickets.ts` as the worked example of a
    // tenant-scoped query — yet they sat outside every glob while four documents, SECURITY.md included,
    // said the ban was enforced. Not under UI_GLOBS because jsx-no-literals and the a11y-attribute rule
    // do not belong on a query module.
    //
    // TESTS are exempt, unlike under UI_GLOBS: a test resolving seed ids by slug to arrange a case is
    // not a request path, and `fakeDb.getDb()` inside an `ids()` helper is the pattern keel's own
    // suites already use. The ban is about production code that serves a request.
    {
        files: ['apps/*/src/domain/**/*.{ts,tsx}', 'apps/*/src/jobs/**/*.{ts,tsx}'],
        ignores: ['**/*.test.{ts,tsx}'],
        rules: {
            'no-restricted-syntax': [
                'error',
                getDbSelector,
                getDbComputedSelector,
                getDbDestructureSelector,
                processEnvSelector,
            ],
        },
    },
    // i18n: UI code may not contain hard-coded strings — everything goes through next-intl (ADR-0008).
    // demo-static is INCLUDED on both sides of the line: the `file://` shell, the tour overlay and each
    // app's static twin are user-visible UI that ships to whoever is handed dist-demo/index.html, and
    // they render from the same merged catalog as the server screens. They sat outside this fence until
    // the framework extraction gave keel 640 lines of its own demo UI; both sides already comply, so
    // covering them costs nothing today and stops the next edit hard-coding a string.
    {
        files: [
            'apps/*/src/app/**/*.tsx',
            'apps/*/src/components/**/*.tsx',
            'apps/*/src/demo-static/**/*.tsx',
            'packages/keel/src/components/**/*.tsx',
            'packages/keel/src/demo-static/**/*.tsx',
        ],
        rules: {
            'react/jsx-no-literals': ['error', { noStrings: true, ignoreProps: true, allowedStrings: [] }],
        },
    },
    // Ports boundary: vendor SDKs only inside keel's adapters (ADR-0003, -0009, -0010, -0011);
    // deployment params only via the app's config/params.ts.
    //
    // The app glob is `apps/*/**`, NOT `apps/*/src/**`. It was the narrower one, which left 48 files
    // per app unfenced — including `config/app.ts`, which is ON the runtime module graph
    // (`src/app-config/identity.ts` re-exports APP_SLUG from it) and `config/params.ts`, which
    // `next.config.ts` imports. A vendor SDK could be imported there with a green `pnpm lint`, while
    // CONTRIBUTING.md called this "the one rule that matters most". A fence with a hole in the wall
    // is worse than no fence, because the claim keeps people from looking.
    //
    // The two carve-outs are the only files that legitimately reach a vendor directly, and both are
    // outside the request path:
    //  - `next.config.ts` composes the Sentry BUILD plugin (`withSentryConfig`), which is a bundler
    //    wrapper, not an SDK call the product makes. ADR-0010 records Sentry as instrumentation
    //    rather than a port for exactly this reason.
    //  - `tests/contract/**` drives real Postgres through `pg`/`embedded-postgres` on purpose — that
    //    IS the anti-drift proof, and routing it through a port would prove nothing about the port.
    {
        files: ['apps/*/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'],
        ignores: ['packages/keel/src/adapters/**', 'apps/*/next.config.ts', 'apps/*/tests/contract/**'],
        rules: {
            'no-restricted-imports': ['error', { patterns: [vendorSdkPattern, nextFontPattern] }],
        },
    },
    // Framework/app fence (ADR-0012): the framework package may not import app content directly — only
    // through the @app-config/* seam. TWO globs: the framework's source tree, and its own test fixture,
    // which is inside the package and must not be the one door left open (see FIXTURE_FILES_GLOB above).
    // vendorSdkPattern re-listed (merge trap) so the ports boundary survives here; adapters and core get
    // their own blocks below and are therefore NOT excluded here — a later block replaces this one for them.
    // The fixture matches no LATER no-restricted-imports block, so this one block is its whole import
    // boundary: the app fence, the ports boundary, and the hermetic-dev ban, exactly as for src/.
    {
        files: [FRAMEWORK_FILES_GLOB, FIXTURE_FILES_GLOB],
        rules: {
            'no-restricted-imports': ['error', { patterns: [vendorSdkPattern, appCodePattern, nextFontPattern] }],
        },
    },
    // The fixture's syntax bans, decided one at a time rather than by inheriting the app's set.
    // APPLIED: getDb (its api/ + domain/ files are the app-shaped request path this template teaches —
    // tenant access goes through withTenant, ADR-0004) and process.env (only keel's adapters read
    // it; the fixture is on the app side of that line). It has no test files of its own — keel's tests
    // live in src/ — so neither needs a test carve-out.
    // NOT APPLIED, deliberately: react/jsx-no-literals and the a11y-attribute literal ban (ADR-0008).
    // Those govern user-visible COPY, and the fixture ships none: it has no components tree, and its
    // route files are scanned by authorized-mutations.test.ts, never served. Applying them would assert
    // a catalog obligation over files no user can ever read.
    {
        files: [FIXTURE_FILES_GLOB],
        rules: {
            'no-restricted-syntax': [
                'error',
                getDbSelector,
                getDbComputedSelector,
                getDbDestructureSelector,
                processEnvSelector,
            ],
        },
    },
    // Adapters are fenced against app content too, but MAY import vendor SDKs (that is their job) — so
    // this block carries appCodePattern only (no vendorSdkPattern). It is the ONLY no-restricted-imports
    // block matching packages/keel/src/adapters (the ports-boundary block above ignores it).
    {
        files: ['packages/keel/src/adapters/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-imports': ['error', { patterns: [appCodePattern, nextFontPattern] }],
        },
    },
    // keel/core stays framework-free (ADR-0006) AND fenced from app content (ADR-0012) — vendor + app
    // patterns repeated on purpose (merge trap), see the notes above.
    {
        files: ['packages/keel/src/core/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        vendorSdkPattern,
                        appCodePattern,
                        {
                            group: ['react', 'react-*', 'next', 'next/*', 'next-intl', 'next-intl/*', '@mantine/*'],
                            message: 'keel/core is pure TypeScript — no framework imports (ADR-0006).',
                        },
                    ],
                },
            ],
        },
    },
    // keel's public surface (see keelPublicSurfaceRule above). Repo-wide on purpose: apps, repo
    // scripts, infra and the other workspace packages all resolve `keel/…` through an alias, so all
    // of them are consumers the map has to hold for. Inside packages/keel the specifier never
    // appears (imports there are relative), so this also catches a self-import through the alias.
    {
        files: ['**/*.{js,jsx,mjs,cjs,ts,tsx}'],
        plugins: { keel: { rules: { 'public-surface': keelPublicSurfaceRule } } },
        rules: { 'keel/public-surface': 'error' },
    },
    prettierConfig,
]

export default eslintConfig
