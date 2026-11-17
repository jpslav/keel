import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import js from '@eslint/js'
import nextPlugin from '@next/eslint-plugin-next'
import prettierConfig from 'eslint-config-prettier'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import typescriptEslint from 'typescript-eslint'

// EVERY extension a fence below names. ESLint lints all eight in this repo (its own defaults are .js,
// .mjs and .cjs, typescript-eslint's recommended config adds .ts, .tsx, .mts and .cts, and the react
// block below adds .jsx), so a fence that names a DIRECTORY has to hold for each of them. The fences
// used to say `*.{ts,tsx}`, which let a `.mjs` file in apps/*/src or packages/keel/src import a vendor
// SDK, read process.env or take the raw db handle with a green `pnpm lint`; nothing in the tree did, and
// nothing would have said so if something had. Every fence glob takes its extensions from here. The
// carve-outs do NOT (TEST_FILES and STORY_FILES below, the next.config and instrumentation ones further
// down): a carve-out names what a runner actually picks up, and a file it does not pick up keeps every ban.
const SRC_EXT = '{ts,tsx,mts,cts,js,jsx,mjs,cjs}'
// vitest's include globs (vitest.config.ts) name `*.test.{ts,tsx}` and nothing else, so a `.test.mjs`
// under src/ is an ordinary module that a route can import, and it stays fenced.
const TEST_FILES = '**/*.test.{ts,tsx}'
// Ladle's stories glob (apps/showcase/.ladle/config.mjs), extension for extension.
const STORY_FILES = '**/*.stories.{js,jsx,ts,tsx}'

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
        "Vendor SDKs may only be imported inside an adapters directory: packages/keel/src/adapters/ for keel's " +
        'ports, apps/<app>/src/adapters/real/ for a port the app owns (docs/recipes/app-owned-adapter.md). ' +
        'Code against the port instead (see CONTRIBUTING.md).',
}

// WHERE a vendor SDK may be imported: keel's adapters, and an app's REAL adapters (ADR-0012, addendum
// 2026-11-16). Named once because two mechanisms enforce the one rule: `no-restricted-imports` sees
// static imports and re-exports, `keel/no-dynamic-vendor-import` sees `import()` — and a zone the two
// spelled differently would be a hole in exactly one of them.
//
// The app's zone is `adapters/real/`, NOT all of `adapters/`, on purpose. An app's fake and its
// registry are what keep `pnpm dev` hermetic, so they get the same bans as the rest of the app: no
// vendor SDK, no process.env, no static import of real/. The registry therefore cannot read the run mode
// itself and takes keel's `isSimulated` (and with it keel's fail-closed production guard), and the fake
// has nothing to configure. keel's own tree has never needed that split — none of its fakes imports a
// vendor SDK — but it is curated by keel's maintainers; an adopter writes this directory without having
// read the history. (Lint cannot follow an imported value to its source, so a helper somewhere the
// process.env ban does not reach could still hand the registry its own idea of the mode. The ban covers
// apps/*/src and apps/*/config, which is where such a helper would naturally go.)
const KEEL_ADAPTERS_GLOB = 'packages/keel/src/adapters/**'
const APP_ADAPTERS_GLOB = 'apps/*/src/adapters/**'
const APP_REAL_ADAPTERS_GLOB = 'apps/*/src/adapters/real/**'
// The files both halves of the vendor ban cover, and the two carve-outs both leave out (the ports-boundary
// block below says why each carve-out exists). Named once for the same reason as the zones above.
// `next.config.*` is the four names Next loads its config from (CONFIG_FILES in next's
// shared/lib/constants), and no other file at the app root.
const VENDOR_FENCE_FILES = [`apps/*/**/*.${SRC_EXT}`, `packages/*/src/**/*.${SRC_EXT}`]
const VENDOR_CARVE_OUTS = ['apps/*/next.config.{ts,mts,js,mjs}', 'apps/*/tests/contract/**']

// An app's real adapter is reached through the app's adapter registry (apps/<app>/src/adapters/index.ts),
// the module that picks the fake in simulated mode — the role keel's exports map plays for keel's own
// real adapters, which are internals. Matches `@/…/adapters/real` and its ordinary relative spellings
// (`../adapters/real`, `../../adapters/real`), and nothing that starts with `keel/`, so keel's three
// published real-mode components stay importable. It reads the specifier as written: an unnormalized one
// (`../adapters/fake/../real/kv`) gets past it, as a computed specifier gets past every import rule.
//
// STATIC imports only, and deliberately so: `no-restricted-imports` does not see `import()`, and a
// dynamic import inside an `!isSimulated` branch is exactly how a real-mode-only component is reached —
// keel's own sign-in form is loaded that way by the app's sign-in page.
const appRealAdapterPattern = {
    regex: '^(?:@|\\.{1,2})/(?:.*/)?adapters/real(?:/|$)',
    message:
        "Reach the app's real adapters through its registry (apps/<app>/src/adapters/index.ts), which serves " +
        'the fake in simulated mode — a static import loads the vendor in every run mode and skips the fake. ' +
        'A real-mode-only component is the exception, reached by import() inside an !isSimulated branch the ' +
        "way keel's sign-in form is (docs/recipes/app-owned-adapter.md).",
}
// INSIDE the app's adapters directory the rule is stricter: real/ is reached only by `import()`, and the
// registry's `await import('./real/index')` when !isSimulated is the one place that should do it. A static
// import from a fake would load the vendor SDK into a simulated `pnpm dev`, and from the registry it would
// load it in every mode. Matches `./real`, `../real`, `../../adapters/real` and `@/…/adapters/real`.
// keel publishes a few of its own real adapters (the LLM client, the real-mode forms). A fake or the registry
// importing one statically would load its vendor SDK in simulated mode just the same.
const keelRealAdapterPattern = {
    regex: '^keel/adapters/real/',
    message:
        "An app's registry and fakes never import keel's real adapters: that loads the vendor SDK in simulated " +
        'mode. Reach keel through its registry (keel/adapters/index) (docs/recipes/app-owned-adapter.md).',
}
const appRealAdapterStaticPattern = {
    regex: '^(?:@/(?:.*/)?adapters|\\.{1,2}(?:/.*)?)/real(?:/|$)',
    message:
        "Inside apps/<app>/src/adapters, real/ is loaded only with import() — the registry's " +
        "`await import('./real/index')` when !isSimulated. A static import loads the vendor SDK in simulated " +
        'mode too (docs/recipes/app-owned-adapter.md).',
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
// what makes a destructured parameter count. A key spelled as a template literal with no expressions
// (``db[`getDb`]``) or quoted (`const { 'getDb': g } = db`) names it just the same, so both match too.
//
// They travel TOGETHER, as getDbSelectors, and no block lists them one by one. A block that listed them
// one by one dropped the computed form for every route, page and component (the a11y block below, which
// is the last no-restricted-syntax block for those files, so its list was the one that counted), and
// `db['getDb']()` passed lint in a route handler although the two blocks before it listed the selector.
const getDbSelector = {
    selector: 'MemberExpression[property.name="getDb"]',
    message:
        'Route/UI code must not use the raw db handle — use db.withTenant() (or a keel/db helper) so RLS tenant context is set (ADR-0004).',
}
const getDbComputedSelector = {
    selector:
        'MemberExpression[computed=true]:matches([property.value="getDb"], [property.quasis.0.value.cooked="getDb"])',
    message:
        "Reaching the raw db handle as db['getDb'] bypasses the same rule — use db.withTenant() (or a keel/db helper) so RLS tenant context is set (ADR-0004).",
}
const getDbDestructureSelector = {
    selector:
        'ObjectPattern > Property:matches([key.name="getDb"], [key.value="getDb"], [key.quasis.0.value.cooked="getDb"])',
    message:
        'Destructuring getDb out of the db port bypasses the same rule — use db.withTenant() (or a keel/db helper) so RLS tenant context is set (ADR-0004).',
}
const getDbSelectors = [getDbSelector, getDbComputedSelector, getDbDestructureSelector]
// Also the import form — `import { env }`, or a default or namespace import, from `process`/`node:process`
// — which reads the same object under another name (a type-only import, or `import { cwd }`, does not).
// Nothing in the tree uses it. It closes that one form: re-exporting `env` from `node:process`, or
// `const { env } = process`, still gets past, as any alias does.
const processEnvSelector = {
    selector:
        ':matches(MemberExpression[object.name="process"][property.name="env"], ' +
        'ImportDeclaration[importKind!="type"][source.value=/^(node:)?process$/] > ' +
        ':matches(ImportSpecifier[imported.name="env"], ImportDefaultSpecifier, ImportNamespaceSpecifier))',
    message:
        "process.env is read ONLY inside an adapters directory — packages/keel/src/adapters, or an app's own " +
        'apps/<app>/src/adapters/real (CLAUDE.md) — deployment/service params come from the app ' +
        'config/params.ts, run mode from keel/adapters (isSimulated/isDemoMode). Secret readers are exempted ' +
        'per-file in eslint.config.mjs.',
}
// An app's real adapter may read its OWN configuration from process.env, but never the run mode. That is
// keel's: `appMode`/`isSimulated`/`isDemoMode` from keel/adapters/index, whose import also runs the
// fail-closed production guard. A second reader of APP_MODE can disagree with it (keel treats a legacy
// `APP_MODE=fake` as simulated) and never runs the guard. Matched: `process.env.X`, `process.env['X']`,
// ``process.env[`X`]``, and destructuring in a declaration, an assignment or a parameter default (quoted
// keys included). As with the getDb selectors above, no lint rule chases an alias
// (`const env = process.env; env.APP_MODE`, or `env` imported from `node:process`).
const RUN_MODE_ENV = '/^(APP_MODE|DEMO_MODE|E2E_BUILD)$/'
const runModeEnvMessage =
    "Run mode is keel's — import isSimulated/isDemoMode/appMode from keel/adapters/index. An app adapter " +
    "that reads APP_MODE, DEMO_MODE or E2E_BUILD itself can disagree with keel's registry and skips its " +
    'fail-closed production guard (docs/recipes/app-owned-adapter.md).'
const runModeEnvSelector = {
    selector:
        'MemberExpression[object.object.name="process"][object.property.name="env"]' +
        `:matches([property.name=${RUN_MODE_ENV}], [property.value=${RUN_MODE_ENV}], ` +
        `[property.quasis.0.value.cooked=${RUN_MODE_ENV}])`,
    message: runModeEnvMessage,
}
// Destructuring in a declaration, an assignment, or a parameter default — each puts `process.env` on the
// right of the pattern under a different parent node.
const runModeEnvDestructureSelector = {
    selector:
        ':matches(VariableDeclarator[init.object.name="process"][init.property.name="env"], ' +
        'AssignmentExpression[right.object.name="process"][right.property.name="env"], ' +
        'AssignmentPattern[right.object.name="process"][right.property.name="env"]) > ObjectPattern > ' +
        `Property:matches([key.name=${RUN_MODE_ENV}], [key.value=${RUN_MODE_ENV}])`,
    message: runModeEnvMessage,
}
// Together, for the reason getDbSelectors are.
const runModeEnvSelectors = [runModeEnvSelector, runModeEnvDestructureSelector]
// Inside an app's adapters directory, only the registry loads real/. A fake, or a second module, doing
// `await import('../real/kv')` would put the vendor SDK behind code that never asks the run mode. The
// static form is appRealAdapterStaticPattern (no-restricted-imports); this is the dynamic one.
const REAL_DIR = '/(^|[/])real([/]|$)/'
const appRealAdapterDynamicSelector = {
    selector: `ImportExpression:matches([source.value=${REAL_DIR}], [source.quasis.0.value.cooked=${REAL_DIR}])`,
    message:
        "Only the app's registry (apps/<app>/src/adapters/index.ts) loads real/, with import() when " +
        '!isSimulated. Anywhere else in the adapters directory it would load the vendor SDK without asking the ' +
        'run mode (docs/recipes/app-owned-adapter.md).',
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
const FRAMEWORK_FILES_GLOB = `packages/keel/src/**/*.${SRC_EXT}`
const FRAMEWORK_COMPONENTS_GLOB = `packages/keel/src/components/**/*.${SRC_EXT}`
const UI_GLOBS = [`apps/*/src/app/**/*.${SRC_EXT}`, `apps/*/src/components/**/*.${SRC_EXT}`, FRAMEWORK_COMPONENTS_GLOB]

// keel's OWN app seam (ADR-0012): packages/keel/test-fixture is app-SHAPED code that lives
// inside the framework package, and it is the seam the root program resolves `@app-config/*` through.
// It is NOT under src/, and every glob above says `src/`, so it started life outside every boundary
// block in this file — the one directory in packages/keel where importing an app's `@/*` alias or
// `@app/seed` was legal. A type-only import there is erased at runtime and the root tsc resolves `@/*`
// program-wide, so it would have passed lint, typecheck AND vitest, and broken only at
// `pnpm init-app --eject-showcase` — the exact failure the fixture exists to remove. It is therefore
// named explicitly wherever a rule is about a FRAMEWORK invariant. See the fixture blocks below for
// which rules apply and which deliberately do not.
const FIXTURE_FILES_GLOB = `packages/keel/test-fixture/**/*.${SRC_EXT}`

// ---------------------------------------------------------------------------------------------
// keel's PUBLIC SURFACE (ADR-0012).
//
// The package `exports` map names the 130 subpaths an app may import (128 modules + the two message
// catalogs); the other 37 modules under `src/` are internals reachable only by relative import inside
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

// ---------------------------------------------------------------------------------------------
// NO RAW mkdtemp IN TESTS. A test that calls `mkdtemp`/`mkdtempSync` itself leaves the directory
// behind on every run, and enough runs filled a dev machine's temp filesystem past 100GB. Tests make
// scratch directories through tests/support/tmp-dir.ts, which queues the removal. Its own rule id,
// not a `no-restricted-syntax` selector: that rule's config merges by key, so a later block that
// re-declares it for overlapping files REPLACES this one without a word (the merge trap above).
//
// Deliberately narrow: it matches the call by the NAME it is made under — bare `mkdtempSync(…)`,
// `fs.mkdtempSync(…)`, `fsp.mkdtemp(…)`, `await mkdtemp(…)` — and not a renamed import
// (`import { mkdtemp as m }`) or a computed key. No lint rule chases an arbitrary alias; the
// per-run TMPDIR sweep in scripts/check-tmpdir-leak.mjs is what bounds the damage if one slips by.
/** @type {import('eslint').Rule.RuleModule} */
const keelNoDirectMkdtempRule = {
    meta: {
        type: 'problem',
        docs: { description: 'Tests make scratch directories through tests/support/tmp-dir.ts, never a raw mkdtemp.' },
        schema: [],
        messages: {
            direct:
                '`{{name}}()` leaves its directory behind on every test run. Use makeTestTmpDir() / ' +
                'makeTestTmpDirAsync() from tests/support/tmp-dir.ts, which removes the directory when the ' +
                'test file finishes — or, in a Playwright spec, testInfo.outputPath(), which Playwright ' +
                'clears at the start of every run.',
        },
    },
    create(context) {
        const report = (node, name) => context.report({ node, messageId: 'direct', data: { name } })
        return {
            'CallExpression[callee.type="Identifier"][callee.name=/^mkdtemp(Sync)?$/]': (node) =>
                report(node, node.callee.name),
            'CallExpression[callee.type="MemberExpression"][callee.computed=false][callee.property.name=/^mkdtemp(Sync)?$/]':
                (node) => report(node, node.callee.property.name),
        }
    },
}

// ---------------------------------------------------------------------------------------------
// NO DYNAMIC VENDOR IMPORT outside an adapters directory. `no-restricted-imports` checks import and
// export DECLARATIONS only — it never sees `import()` — so until this rule existed,
// `await import('@aws-sdk/client-s3')` passed `pnpm lint` in an app's domain module, a route, or
// keel's own server-lib, while CLAUDE.md called the vendor boundary lint-enforced. It went unnoticed
// because nothing in the tree did it; it mattered once app-owned adapters made `await import('./real/…')`
// the house idiom one directory away. Static imports stay with `no-restricted-imports`
// (vendorSdkPattern); this rule covers `import()`, `require()` and vitest/jest's `importActual`,
// `requireActual`, `importMock` and `requireMock` with the SAME list, read from vendorSdkPattern.group,
// so there is no second list to drift. `createRequire(...)(…)` and `module.require(…)` are out of reach.
//
// The specifier must be a literal (or a template with no expressions). A computed one —
// `import(name)` — is out of reach, as it is for every import rule.
const isVendorSpecifier = (specifier) =>
    vendorSdkPattern.group.some((pattern) =>
        pattern.endsWith('/*')
            ? specifier.startsWith(pattern.slice(0, -1)) && specifier.length > pattern.length - 1
            : specifier === pattern || specifier.startsWith(`${pattern}/`),
    )

/** @type {import('eslint').Rule.RuleModule} */
const keelNoDynamicVendorImportRule = {
    meta: {
        type: 'problem',
        docs: { description: 'Vendor SDKs are not imported dynamically outside an adapters directory.' },
        schema: [],
        messages: {
            dynamic:
                '`{{specifier}}` is a vendor SDK, and loading it with import() or require() is still importing ' +
                "it. Vendor SDKs live only in packages/keel/src/adapters/ (keel's ports) or " +
                'apps/<app>/src/adapters/real/ (a port the app owns) — code against the port instead ' +
                '(docs/recipes/app-owned-adapter.md).',
        },
    },
    create(context) {
        const check = (node) => {
            const specifier =
                node?.type === 'Literal'
                    ? node.value
                    : node?.type === 'TemplateLiteral' && node.expressions.length === 0
                      ? node.quasis[0].value.cooked
                      : undefined
            if (typeof specifier !== 'string' || !isVendorSpecifier(specifier)) return
            context.report({ node, messageId: 'dynamic', data: { specifier } })
        }
        return {
            ImportExpression: (node) => check(node.source),
            'CallExpression[callee.name="require"]': (node) => check(node.arguments[0]),
            // A test inside the fence loads the real module with these, exactly as with import().
            'CallExpression[callee.object.name=/^(vi|jest)$/][callee.property.name=/^(importActual|requireActual|importMock|requireMock)$/]':
                (node) => check(node.arguments[0]),
        }
    },
}

// ONE plugin object, shared by every block that registers `keel/*` rules. Flat config checks plugin
// identity across overlapping blocks, so two inline `{ keel: { rules: … } }` literals matching the
// same file would be a "Cannot redefine plugin" error the moment a file matched both.
const keelPlugin = {
    rules: {
        'public-surface': keelPublicSurfaceRule,
        'no-direct-mkdtemp': keelNoDirectMkdtempRule,
        'no-dynamic-vendor-import': keelNoDynamicVendorImportRule,
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
    // Every extension, not the four this block used to name: the i18n block below bans literals in `.mjs`
    // screens too, and `react/jsx-no-literals` cannot be configured for a file this block, which registers
    // the plugin, does not match (ESLint throws "Could not find plugin").
    {
        files: [`**/*.${SRC_EXT}`],
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
        files: [`apps/*/src/**/*.${SRC_EXT}`, FRAMEWORK_FILES_GLOB],
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
            'no-restricted-syntax': ['error', ...getDbSelectors],
        },
    },
    // params centralization (CLAUDE.md): process.env is read ONLY inside keel's adapters and an app's own real
    // adapters — every other module
    // imports the resolved value (the app's config/params.ts for deployment params; isSimulated/isDemoMode
    // from keel/adapters for run mode). Exempt: adapters, instrumentation (NEXT_PUBLIC needs literal inlining),
    // the two secret readers, and test files (which set APP_DATA_DIR for isolation). App/component
    // non-test files also get the ban — re-listing getDbSelectors so their getDb ban survives the merge.
    {
        files: UI_GLOBS,
        ignores: [TEST_FILES],
        rules: {
            'no-restricted-syntax': ['error', ...getDbSelectors, processEnvSelector],
        },
    },
    // Targeted a11y-attribute literal ban (ADR-0008): non-test, non-story app/component code. Re-lists the
    // getDb + process.env selectors (merge trap) so this block, being last for a regular component,
    // still enforces them. Stories render fixtures, not shipped UI, so they are carved out.
    {
        files: UI_GLOBS,
        ignores: [TEST_FILES, STORY_FILES],
        rules: {
            'no-restricted-syntax': ['error', ...getDbSelectors, processEnvSelector, a11yLiteralSelector],
        },
    },
    {
        // apps/*/config too: params.ts records names and placeholders and never reads the environment, and
        // without it the directory beside src/ was the obvious place for a helper that hands an app's registry
        // its own reading of APP_MODE.
        files: [`apps/*/src/**/*.${SRC_EXT}`, `apps/*/config/**/*.${SRC_EXT}`, FRAMEWORK_FILES_GLOB],
        ignores: [
            'apps/*/src/app/**',
            'apps/*/src/components/**',
            'packages/keel/src/components/**',
            KEEL_ADAPTERS_GLOB,
            APP_REAL_ADAPTERS_GLOB,
            // Next's two instrumentation hooks, under the default pageExtensions Next looks for them with
            // (neither app sets its own), and no other name: `instrumentation-helpers.ts` is an ordinary
            // module, as the `*` this used to carry let it pretend not to be.
            'apps/*/src/instrumentation{,-client}.{ts,tsx,js,jsx}',
            'packages/keel/src/service-auth/webhook.ts',
            'packages/keel/src/service-auth/mailgun.ts',
            TEST_FILES,
        ],
        rules: {
            'no-restricted-syntax': ['error', processEnvSelector],
        },
    },
    // An app's REAL adapters read their own configuration from process.env, like keel's — but not the run
    // mode (runModeEnvSelector above). Only real/: the app's registry and fakes keep the full ban from the
    // block above (see APP_REAL_ADAPTERS_GLOB). That block ignores real/, so besides the stories block right
    // below, this is the only no-restricted-syntax block matching these files and there is nothing to
    // re-list; the ignore is what keeps that true if the blocks are reordered (as in the ports boundary
    // below). Tests exempt, as above. The a11y-attribute literal ban rides along because a real-mode-only
    // component (a vendor widget) lives here and renders copy; keel's own adapters get it from the
    // `packages/keel/src/adapters` block further down.
    {
        files: [`apps/*/src/adapters/real/**/*.${SRC_EXT}`],
        ignores: [TEST_FILES],
        rules: {
            'no-restricted-syntax': ['error', ...runModeEnvSelectors, a11yLiteralSelector],
        },
    },
    // A story beside a real-mode component renders fixtures, not shipped copy, so it drops the a11y ban as
    // stories do everywhere else, and keeps the run-mode ban (this block replaces the one above for it).
    {
        files: [`apps/*/src/adapters/real/${STORY_FILES}`],
        rules: {
            'no-restricted-syntax': ['error', ...runModeEnvSelectors],
        },
    },
    // The rest of an app's adapters directory except the registry — its fakes, and any module beside them.
    // Re-lists processEnvSelector (merge trap: this block replaces the process.env block above for these
    // files), adds the dynamic half of "only the registry loads real/", and the a11y-attribute literal ban
    // for a fake that renders copy. Tests fall back to the process.env block above, which exempts them.
    // The registry is `index.ts` and nothing else, as the recipe names it: an `index.mjs` beside it is one
    // more module that may not load real/.
    {
        files: [`apps/*/src/adapters/**/*.${SRC_EXT}`],
        ignores: [APP_REAL_ADAPTERS_GLOB, 'apps/*/src/adapters/index.ts', TEST_FILES, STORY_FILES],
        rules: {
            'no-restricted-syntax': ['error', processEnvSelector, appRealAdapterDynamicSelector, a11yLiteralSelector],
        },
    },
    // A story beside a fake drops the a11y ban as stories do everywhere, and keeps the other two. It used to
    // fall back to the process.env block alone, which dropped the dynamic real/ ban with the a11y one: a
    // fake's story could `import('../real/kv')` and put the vendor SDK in the workshop, though a STATIC
    // import of the same path was banned there (the no-restricted-imports block below ignores no stories).
    {
        files: [`apps/*/src/adapters/${STORY_FILES}`],
        ignores: [APP_REAL_ADAPTERS_GLOB],
        rules: {
            'no-restricted-syntax': ['error', processEnvSelector, appRealAdapterDynamicSelector],
        },
    },
    // keel's adapters render copy too (the real sign-in and accept-invite forms), and no other
    // no-restricted-syntax block matches them. Labels arrive as props today; this keeps it that way.
    {
        files: [`${KEEL_ADAPTERS_GLOB}/*.${SRC_EXT}`],
        ignores: [TEST_FILES, STORY_FILES],
        rules: {
            'no-restricted-syntax': ['error', a11yLiteralSelector],
        },
    },
    // Same tenancy ban as UI_GLOBS, wider net — and it MUST come after the process.env block above,
    // which matches `apps/*/src/**` and so replaced an earlier getDb block for these files outright.
    // That is the merge trap this file documents at the top, walked into once while adding this rule:
    // the ban silently did nothing, and only `--print-config` showed why. It re-lists getDbSelectors
    // AND processEnvSelector for the same reason every other block here does.
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
        files: [`apps/*/src/domain/**/*.${SRC_EXT}`, `apps/*/src/jobs/**/*.${SRC_EXT}`],
        ignores: [TEST_FILES],
        rules: {
            'no-restricted-syntax': ['error', ...getDbSelectors, processEnvSelector],
        },
    },
    // i18n: UI code may not contain hard-coded strings — everything goes through next-intl (ADR-0008).
    // demo-static is INCLUDED on both sides of the line: the `file://` shell, the tour overlay and each
    // app's static twin are user-visible UI that ships to whoever is handed dist-demo/index.html, and
    // they render from the same merged catalog as the server screens. They sat outside this fence until
    // the framework extraction gave keel 640 lines of its own demo UI; both sides already comply, so
    // covering them costs nothing today and stops the next edit hard-coding a string.
    //
    // Every extension (SRC_EXT), not `.tsx` alone: a `.jsx` or `.js` screen renders copy as well, and the
    // rule only ever fires on JSX, so on a `.ts` file it costs nothing.
    {
        files: [
            `apps/*/src/app/**/*.${SRC_EXT}`,
            `apps/*/src/components/**/*.${SRC_EXT}`,
            `apps/*/src/demo-static/**/*.${SRC_EXT}`,
            `packages/keel/src/components/**/*.${SRC_EXT}`,
            `packages/keel/src/demo-static/**/*.${SRC_EXT}`,
            // Real-mode-only components live in adapter directories, on both sides of the line, and render
            // copy. keel's already complied when they were added here.
            `${KEEL_ADAPTERS_GLOB}/*.${SRC_EXT}`,
            `${APP_ADAPTERS_GLOB}/*.${SRC_EXT}`,
        ],
        rules: {
            'react/jsx-no-literals': ['error', { noStrings: true, ignoreProps: true, allowedStrings: [] }],
        },
    },
    // Ports boundary: vendor SDKs only inside keel's adapters (ADR-0003, -0009, -0010, -0011) or an app's
    // own real adapters (ADR-0012, addendum 2026-11-16); deployment params only via the app's config/params.ts.
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
    //    rather than a port for exactly this reason. The carve-out names all four spellings Next
    //    loads (VENDOR_CARVE_OUTS); any other root config (playwright, vite, panda, postcss, ladle) is
    //    fenced like the rest of the app.
    //  - `tests/contract/**` drives real Postgres through `pg`/`embedded-postgres` on purpose — that
    //    IS the anti-drift proof, and routing it through a port would prove nothing about the port.
    //
    // An app's own adapters directory is carved out too, and fenced by the two blocks right below
    // instead. Everywhere else in the app this block also bans a STATIC import of the app's real
    // adapters (appRealAdapterPattern): they are reached through the app's registry.
    //
    // The carve-out is about ORDER, not outcome: without it the two blocks below would still win for
    // that directory, but only because they come later (the merge trap). With it they are the only
    // no-restricted-imports blocks matching it, and moving a block cannot change what is allowed there.
    // tests/lint/app-owned-adapters.test.ts pins the outcome; a mutation run showed it cannot see this line.
    {
        files: VENDOR_FENCE_FILES,
        ignores: [KEEL_ADAPTERS_GLOB, APP_ADAPTERS_GLOB, ...VENDOR_CARVE_OUTS],
        rules: {
            'no-restricted-imports': [
                'error',
                { patterns: [vendorSdkPattern, nextFontPattern, appRealAdapterPattern] },
            ],
        },
    },
    // App-owned adapters (ADR-0012, addendum 2026-11-16) — for a vendor keel has no port for, which fails
    // the universality and new-class tests (docs/development-approach.md) and so belongs to the app, not
    // to keel. The registry (adapters/index.ts) and the fakes keep the vendor ban; only real/ may import a
    // vendor SDK. Both re-list nextFontPattern (merge trap). The registry and fakes carry the STRICTER
    // appRealAdapterStaticPattern instead of appRealAdapterPattern: no static import of real/ at all, so the
    // registry's import() is the only way in.
    {
        files: [`${APP_ADAPTERS_GLOB}/*.${SRC_EXT}`],
        ignores: [APP_REAL_ADAPTERS_GLOB],
        rules: {
            'no-restricted-imports': [
                'error',
                { patterns: [vendorSdkPattern, nextFontPattern, appRealAdapterStaticPattern, keelRealAdapterPattern] },
            ],
        },
    },
    {
        files: [`${APP_REAL_ADAPTERS_GLOB}/*.${SRC_EXT}`],
        rules: {
            'no-restricted-imports': ['error', { patterns: [nextFontPattern] }],
        },
    },
    // The dynamic half of the vendor boundary (see keelNoDynamicVendorImportRule). Its own rule id, so the
    // merge trap cannot touch it; its scope is every file the static ban covers, minus the same two vendor
    // zones and the same two carve-outs — the fixture included, as in the framework fence below.
    {
        files: [...VENDOR_FENCE_FILES, FIXTURE_FILES_GLOB],
        ignores: [KEEL_ADAPTERS_GLOB, APP_REAL_ADAPTERS_GLOB, ...VENDOR_CARVE_OUTS],
        plugins: { keel: keelPlugin },
        rules: { 'keel/no-dynamic-vendor-import': 'error' },
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
    // tenant access goes through withTenant, ADR-0004) and process.env (only keel's adapters and an app's
    // own real adapters read it; the fixture is on the app side of that line). It has no test files of its
    // own — keel's tests live in src/ — so neither needs a test carve-out.
    // NOT APPLIED, deliberately: react/jsx-no-literals and the a11y-attribute literal ban (ADR-0008).
    // Those govern user-visible COPY, and the fixture ships none: it has no components tree, and its
    // route files are scanned by authorized-mutations.test.ts, never served. Applying them would assert
    // a catalog obligation over files no user can ever read.
    {
        files: [FIXTURE_FILES_GLOB],
        rules: {
            'no-restricted-syntax': ['error', ...getDbSelectors, processEnvSelector],
        },
    },
    // Adapters are fenced against app content too, but MAY import vendor SDKs (that is their job) — so
    // this block carries appCodePattern only (no vendorSdkPattern). The ports-boundary block above ignores
    // packages/keel/src/adapters, and the framework fence above matches it but comes earlier, so this
    // block's list is the one that counts there.
    {
        files: [`${KEEL_ADAPTERS_GLOB}/*.${SRC_EXT}`],
        rules: {
            'no-restricted-imports': ['error', { patterns: [appCodePattern, nextFontPattern] }],
        },
    },
    // keel/core stays framework-free (ADR-0006) AND fenced from app content (ADR-0012) — vendor, app and
    // font patterns repeated on purpose (merge trap), see the notes above. The font ban was the one this
    // block forgot; `next/*` below happened to cover it, with core's message rather than the font one.
    {
        files: [`packages/keel/src/core/**/*.${SRC_EXT}`],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        vendorSdkPattern,
                        appCodePattern,
                        nextFontPattern,
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
        files: [`**/*.${SRC_EXT}`],
        plugins: { keel: keelPlugin },
        rules: { 'keel/public-surface': 'error' },
    },
    // No raw mkdtemp in tests (see keelNoDirectMkdtempRule). `**/*.test.{ts,tsx}` covers every unit and
    // contract test, packages/keel/test-fixture included; `apps/*/tests/**` adds the Playwright specs
    // and their support files, which are `.spec.ts` or plain helpers and which no leak guard wraps; the
    // fixture glob is named anyway (FIXTURE_FILES_GLOB, as every framework-invariant gate here does) so
    // a future non-`.test` helper added there is covered too. tests/support/tmp-dir.ts is the one place the raw call is
    // meant to live — it matches neither glob, and is ignored explicitly so that stays true if either
    // glob is ever widened. `apps/*/tests/**` takes every extension because Playwright's default
    // testMatch picks up a `.spec.mjs` or `.test.js` there too, and neither app's config narrows it.
    {
        files: [TEST_FILES, `apps/*/tests/**/*.${SRC_EXT}`, FIXTURE_FILES_GLOB],
        ignores: ['tests/support/tmp-dir.ts'],
        plugins: { keel: keelPlugin },
        rules: { 'keel/no-direct-mkdtemp': 'error' },
    },
    prettierConfig,
]

export default eslintConfig

// For eslint.config.mjs's own rule tests only — flat config reads the default export and nothing else.
export const keelNoDirectMkdtempRuleForTests = keelNoDirectMkdtempRule
