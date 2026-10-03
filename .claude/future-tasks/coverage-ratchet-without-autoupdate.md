# Don't ship the coverage ratchet with `autoUpdate: true`

**Priority:** P3 · **Status:** open. Blocked until coverage thresholds are added, and it should be read
**before** that commit is written.
**Found by:** an app derived from this template that shipped the ratchet this repo plans, 2026-10-03.
It was the most frequent source of manual cleanup across that app's whole run, and more than once it
caused a CI failure against thresholds that were green locally.

## The plan this argues against

`vitest.config.ts` has no coverage thresholds yet. Its comment says
`a ratchet (thresholds + autoUpdate) lands after CI baselines`. `docs/build-notes.md` gives the
design: thresholds about 2% below the CI baseline, with `autoUpdate: true`, and "commit those
threshold bumps rather than reverting them". An app that inherited this design and ran it hit two
problems.

## What goes wrong

1. **Every local coverage run rewrites `vitest.config.ts`.** With `autoUpdate: true`, vitest writes
   the measured numbers back into the thresholds whenever coverage beats them. So any session that
   runs `test:coverage` ends up with a config diff unrelated to its change. In the derived app,
   "revert `vitest.config.ts` before committing" became a routine step in nearly every change. The
   advice to commit the bumps does not help, because those numbers came from a local machine and not
   from CI.
2. **The rewrite removes the margin that protects CI.** v8 coverage differed by hundredths of a point
   between a Mac ARM laptop and the Linux x64 CI runner, for the same commit. A threshold pinned from
   a local run therefore failed CI by one or two hundredths on three of four axes. Two separate
   sessions hit this and fixed it the same way, by padding the threshold down by hand. The next local
   run with `autoUpdate` then wrote the margin back out. The cause of the cross-platform difference
   was never found.

## Shape of the change

- **Leave `autoUpdate` off in the config.** Thresholds change only through an explicit ratchet, for
  example a `coverage:ratchet` script that runs `vitest run --coverage --coverage.thresholds.autoUpdate`,
  run deliberately and committed on its own.
- **Pin thresholds from CI's numbers, not a laptop's.** The `lint-typecheck-unit` job already writes
  the coverage summary to the job summary. Ratchet from those numbers, minus a margin wider than the
  measured cross-platform drift. A few tenths is enough; the drift seen was hundredths.
- **Amend the plan where it is recorded.** `docs/build-notes.md` is a dated record, so append to it
  rather than editing the old entry. Update the `vitest.config.ts` comment in the same commit that
  adds thresholds.
- Optional, and worth doing once: find which files account for the Mac/Linux difference. If it comes
  down to a handful of platform-dependent branches, excluding or testing them could shrink the
  margin.
