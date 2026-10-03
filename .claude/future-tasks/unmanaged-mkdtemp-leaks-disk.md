# A raw mkdtemp call in a test leaks disk space run over run

**Priority:** P3 · **Status:** open

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
