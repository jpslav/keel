# A raw mkdtemp call in a test leaks disk space run over run

**Was:** P3 · **Status:** RESOLVED 2026-10-03

A test file calling `fs.mkdtempSync`/`mkdtemp` directly creates a temp directory with no queued
removal. One such call, left in place across enough CI/local runs, has filled a machine's temp
filesystem to well over 100GB before anyone noticed — each run's directory survives the run.

**Need:** a shared test helper that wraps `mkdtemp`/`mkdtempSync` and queues the directory's removal
(an `afterEach`/`afterAll`-style cleanup registration), so every test that needs a scratch directory
gets one without hand-rolling cleanup — and an ESLint rule banning a direct `mkdtemp`/`mkdtempSync`
call in a test file outright, as its own rule id (not folded into a generic `no-restricted-syntax`
list, which is easy to silently lose track of on a later merge), so a future test can't reintroduce
the leak.

Evidence: `packages/keel/src/adapters/fake/` (where today's several test files that need a scratch
directory would adopt the shared helper), `eslint.config.mjs` (where the existing style-literal and
public-surface rules already live, the precedent a new rule would follow).

## Resolution

Built as specified, plus a guard the original sketch did not ask for:

- **`tests/support/tmp-dir.ts`** — `makeTestTmpDir(prefix)` / `makeTestTmpDirAsync(prefix)`. Each makes
  the directory, writes an empty SIBLING marker file (`<dir>.keel-test-tmp`, suffix in
  `tests/support/tmp-dir-marker.mjs` so plain node can import it) and queues both for removal in ONE
  `afterAll` registered at the module's top level.
- **`keel/no-direct-mkdtemp`** (`eslint.config.mjs`) — its own rule id, matching `mkdtemp`/`mkdtempSync`
  both bare and as a member call (`fs.mkdtempSync`, `fsp.mkdtemp`), over `**/*.test.{ts,tsx}` plus
  `packages/keel/test-fixture/**`. Pinned by `tests/lint/no-direct-mkdtemp.test.ts`.
- **`scripts/check-tmpdir-leak.mjs`** — `test:unit`, `test:coverage` and `test:contract` run vitest
  with `TMPDIR` pointed at a fresh per-run directory and fail if any marker survives; the run directory
  is deleted afterwards either way.
- Every call site (23 test files) migrated; `scripts/e2e-profile.mjs` already removes its own scratch
  directory and is not a test file, so it stays as it was.

The reasoning, the module-top-level hook and the seen-to-fail proofs are in `docs/build-notes.md`
("Test temp directories are cleaned up by construction").
