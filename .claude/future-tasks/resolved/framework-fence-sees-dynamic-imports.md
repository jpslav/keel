# The framework/app fence and keel/core's fence never see `import()` or a type-position import

**Priority:** P1 · **Status:** resolved 2026-11-16 (`fix/lint-import-fences-getdb-default`)
**Found by:** review round 1 of `fix/lint-fence-gaps`, 2026-11-16. The hole was already on main, and that
branch left it alone because it is a different class from the ones it fixed.

## Resolution

- `eslint.config.mjs` builds every declarationless import ban from one factory,
  `declarationlessImportBan`. It covers `import()`, `require()`, vitest/jest's four loaders and a
  type-position `import('…')` (TSImportType). It takes no options, so the merge trap has nothing to replace.
- Two new rules use it: `keel/no-dynamic-app-import` (appCodePattern's group, on `packages/keel/src` and the
  fixture) and `keel/no-dynamic-framework-import-in-core` (the new `coreFrameworkPattern`, on
  `packages/keel/src/core`). `keel/no-dynamic-vendor-import` moved onto the factory too, and so gained
  the type position.
- Matching: not the regex converter sketched below. The new rules load the `ignore` package from ESLint's
  own dependencies and configure it exactly as `no-restricted-imports` does, so the two halves of each
  fence cannot read a group differently. That carries over the group syntax's quirks (a bare `react` also
  matches `@x/react` and `./react`; matching ignores case).
- `tests/lint/framework-fence.test.ts` pins each form in each zone. It also has a parity table that lints
  every specifier as a declaration and as `import()` and requires the same verdict from both.

## What is true

Two of ADR-0012's fences are `no-restricted-imports` patterns and nothing else:

- the framework/app fence (`appCodePattern`: `@/*`, `@app/seed`), applied to `packages/keel/src` and
  `packages/keel/test-fixture`;
- keel/core's framework ban (`react`, `react-*`, `next`, `next/*`, `next-intl`, `@mantine/*`).

`no-restricted-imports` checks import and export DECLARATIONS only. Measured on the branch's config, each
of these lints clean:

- `export const load = () => import('@app/seed')` in `packages/keel/src/server-lib/x.ts` (any extension);
- `export const load = () => import('@/domain/tickets')` in `packages/keel/test-fixture/domain/x.ts`;
- `export type T = import('@/domain/tickets').Ticket` in the fixture. This is a `TSImportType`, and it is
  exactly the type-only escape the fixture's fence exists to stop (CLAUDE.md: "A type-only import there is
  erased at runtime..."). `import type { Ticket } from '@/domain/tickets'` IS caught.
- `import('next/headers')` and `type T = import('react').ReactNode` in `packages/keel/src/core/x.ts`.

`require()` of the same specifiers is caught only incidentally, by `@typescript-eslint/no-require-imports`.

The vendor fence had the same gap and closed it with a rule of its own, `keel/no-dynamic-vendor-import`
(`docs/build-notes.md`, "App-owned adapters").

## What done looks like

- A rule with its own id (so the merge trap cannot drop it), or one per fence, covering `ImportExpression`,
  `TSImportType`, `require()` and vitest/jest's `importActual`-style loaders, with a literal specifier. It
  reads the SAME groups (`appCodePattern.group`, core's group), so there is no second list to drift.
- Matching has to follow `no-restricted-imports`' gitignore semantics. `isVendorSpecifier` reproduces them
  only for the shapes the vendor list uses (`name`, `scope/*`): core's group has a mid-name wildcard
  (`react-*`), which it would read as a literal name. One converter from a group entry to a regex (`*` to
  `[^/]*`, then `(/.*)?$`) covers all three groups; check it against `vendorSdkPattern.group` before
  replacing `isVendorSpecifier` with it.
- Scope: `FRAMEWORK_FILES_GLOB` and `FIXTURE_FILES_GLOB` for the app fence, minus nothing: keel's adapters
  are fenced from app content too. `packages/keel/src/core/**` for core's.
- Cases in `tests/lint/`, each seen to fail by mutation, as the repo requires of a new gate.
