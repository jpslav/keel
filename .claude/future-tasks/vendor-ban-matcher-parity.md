# The vendor ban's two halves read the vendor list differently

**Priority:** P3 · **Status:** open
**Found by:** the pre-PR review of `fix/lint-import-fences-getdb-default` (2026-11-16). Documented in
`eslint.config.mjs` beside `isVendorSpecifier`, and in `docs/decision-log.md`.

## What is true

The vendor ban has two halves:

- The static half is `no-restricted-imports` with `vendorSdkPattern`. It matches with the `ignore` package
  (gitignore semantics, case-insensitive).
- The declarationless half is `keel/no-dynamic-vendor-import`. It matches with `isVendorSpecifier`, a
  hand-written reading of the same list.

They disagree at the edges. The static half matches a bare name at any depth, so its `pg` flags a local
`./pg` and `some/dir/pg`. Its `@clerk/*` ignores case, so it flags `@CLERK/nextjs`. The declarationless half
flags neither, and `tests/lint/app-owned-adapters.test.ts` pins `./pg` as not a vendor for it.

The framework/app fence and keel/core's fence do not have this problem. Their declarationless rules read
each group through the same matcher as the static half (`matchesPatterns`), and a parity table in
`tests/lint/framework-fence.test.ts` pins that.

## What done looks like

1. Anchor the bare names in `vendorSdkPattern` (`pg`, `posthog-js`, `posthog-node`, `mailgun.js`), so the
   static half stops flagging a local `./pg`. In gitignore syntax a leading `/` anchors a pattern. Check what
   it does to the `pg/*`-style subpaths before relying on it.
2. Replace `isVendorSpecifier` with `matchesPatterns([vendorSdkPattern])`.
3. Add vendor rows to the parity table, including `./pg`, `pg/lib/x`, `pg-boss` and `@CLERK/nextjs`.
4. Update the `./pg` case in `tests/lint/app-owned-adapters.test.ts` to whatever both halves now agree on.

Mutation-test both halves, as the repo requires of a gate.
