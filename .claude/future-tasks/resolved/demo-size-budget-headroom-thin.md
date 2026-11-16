# Demo size budgets are one dependency bump from red

**Priority:** P3 · **Status:** RESOLVED 2026-11-16 (its trigger fired: a starter-derived app sat at 99.3%)
**Found by:** pre-open-sourcing pass, round three, 2026-08-01. Re-measured while verifying this file.

## Where the gate actually stands (re-measured from `pnpm build:demo-static && pnpm check:demo-size`)

`scripts/check-demo-size.mjs` guards the single-file `dist-demo/index.html` demo against silent bloat,
one byte budget per app (`apps/<app>/package.json`'s `check:demo-size` script passes the smaller apps'
budget as an argument; the showcase uses the script's `950_000` default).

| App      | Size (bytes) | Budget (bytes) | Headroom       |
| -------- | ------------ | -------------- | -------------- |
| showcase | 925,639      | 950,000        | 24,361 — 97.4% |
| starter  | 844,836      | 880,000        | 35,164 — 96.0% |

Both pass. Neither has much left: a single vendored library, a base64 image dropped into seed data, or
copy added to a locale namespace could tip either over on the next PR, and whoever hits it will have no
context for why 950,000 (showcase) or 880,000 (starter) were the numbers, or that they were already
this close.

## Why this is not "just raise it now"

The showcase's budget was raised once already (2026-07-31, 920,000 → 950,000) for the Tour engine plus
its first walkthrough, deliberately leaving only ~3% headroom "so the next growth is again a decision
someone has to make on purpose" (see the comment header in `scripts/check-demo-size.mjs`). Pre-raising
either number now, with no feature driving it, would spend that discipline for nothing — the whole
point of a tight budget is that the NEXT session to touch it has to look at what grew and decide
whether it should have.

**This file does not raise the budgets.** It exists so the next person who gets a red
`check:demo-size` is not the first to learn the margin was already this thin.

## What to do when it goes red

1. Re-run `pnpm build:demo-static && pnpm check:demo-size` to see which app and by how much.
2. Find what grew: `git diff --stat` on the PR that tipped it, or compare `dist-demo/index.html`
   sizes before/after locally.
3. If the growth is a real feature (the Tours precedent), raise that app's budget in
   `apps/<app>/package.json`'s `check:demo-size` script, in its own commit, with the same kind of
   comment `check-demo-size.mjs` already carries — what grew, how much, and how much headroom is left
   on purpose.
4. If the growth is incidental (a dependency pulled in more than expected, an asset that should not
   have been inlined), fix that instead of raising the budget.

**Trigger:** either `check:demo-size` script actually failing, or headroom dropping under ~2% for
either app, whichever comes first.

## Resolution

The trigger fired, and the procedure above was followed: find what grew, fix the incidental part, raise or
re-base only for a feature. The measurements were taken by building every first-parent merge since the
first commit, then every code commit of the one that jumped (a build is ~6 s).

**What grew** (bytes, showcase / starter, `pnpm build:demo-static`): 925,623 / 844,820 at the first commit,
944,410 / 854,881 on `main`, so +18,787 / +10,061. All of it in four merges: demo presets (#26) +16,924 /
+8,706, the Simulator's people-and-orgs work (#15) +810 / +769, actors that start with the page (#16)
+855 / +388, the mechanical bundle (#19) +198 / +198. Inside the presets merge: the static twin's replay
+8,596 / +3,013, the operation registry +4,717 / +3,739, the seam module with `extends` +1,474 / +902.

**What was incidental, and is fixed:**

- **valibot in every demo bundle (3,248 starter / 493 showcase).** keel's four preset operation
  definitions were module-level constants, each holding a `v.strictObject(...)` call, which a bundler must
  keep. The demo imports `core/presets` for `expandPreset` and never validates a preset, so valibot and four
  schemas shipped in the starter, which registers no preset. They are built by function now;
  `tests/tooling/static-demo-bundle.test.ts` bundles the entry the way the demo does and fails on the old
  shape. A `/* @__PURE__ */` on the outer call does nothing: its arguments (`v.string()`) are calls too.
- **Mantine's whole stylesheet (130,247 starter / 129,257 showcase, 15% and 14%).** Not growth, a baseline
  nobody had looked at: the apps import `@mantine/core/styles.css` whole, 273 KB for ~100 components, and the
  framework's screens use 33. `scripts/vite-prune-mantine-css.ts`, in each app's `vite.demo.config.ts`,
  drops every rule whose hashed class (`m_77c9d27d`) is in no shipped file. Nothing is reordered, a new
  component brings its own hashes, and there is no list to keep. Per-component imports would have been the
  documented route and were rejected: it is a list a person keeps, and a missing entry is an unstyled
  component that passes every test. Verified by 17 unit tests with each of nine mutations seen red, by
  checking against Mantine's real stylesheet, and by comparing every element's computed style (pseudo
  elements included) between the pruned and unpruned demos across 27 starter and 29 showcase states.

**What was a feature, and is paid for:** the presets, net of the trim ~16.4 KB on the showcase and ~5.5 KB on
the starter. The budgets are **re-based, and went down**: showcase 950,000 → 840,000 (814,660 measured,
3.0% headroom, deliberately thin as before), starter 880,000 → 820,000 (721,386 measured, 12.0%). Both are
below what the unpruned bundle measures, so the pruning (or the lazy definitions) regressing turns the gate
red; the saved bytes are not slack. The reasoning and the numbers are in the header of
`scripts/check-demo-size.mjs`, with the 2026-07-31 Tours raise.

**The decision this file did not foresee: whose number the starter's budget is.** An adopter inherits the
starter's budget, and a budget deliberately 3% over the framework's own size is 3% for THEIR first screens
(an ejected app, one small screen on it, was at 873,581 of 880,000). Two jobs were sharing one number, so
they were split: the showcase's budget paces the framework (every framework screen and twin is in the
showcase, so framework growth costs bytes there first), and the starter's is the adopter's, sized to let the
starter grow to the showcase's size before it asks them anything. It still fails on gross bloat and on the
pruning stopping; bloat of any size in the framework shows up in the showcase first. Rejected: a gate that tells framework baseline from app growth (the bundle has no such attribution,
and the adopter wants a ceiling, not a ledger), and a tight starter number plus a note (red on their second
screen). `init-app` should say the number is now theirs; the proposed wording is in
`docs/decision-log.md`'s entry for this change.

**The gate also warns now.** Under 2% headroom `check-demo-size` still passes but says so (and writes a
GitHub workflow annotation on CI): this file's trigger, "headroom under ~2%", was a thing a person had to
notice by measuring.

**Left over, deliberately:**

- **An app's own preset operation definition still ships in its demo** (~2.8 KB on the showcase, for
  `ticket.assign`'s valibot schema). It sits on the seam module the demo imports for `presets`. A fix is a
  seam change (definitions in a module the demo never imports), which touches ADR-0012, `init-app` and
  `/new-preset-operation`, for 0.3% of the artifact. Do it if an app registers many kinds.
- **The Next apps still serve the whole Mantine stylesheet.** Nothing gates their page weight and the
  static demo is the only artifact with a budget. The same pruning would apply to `next build`'s CSS if a
  page-weight budget is ever added.
- **Computed-style identity was checked, not asserted in CI.** The browser comparison lives in the
  record of this change, not in `pnpm verify`; the unit tests, the check against Mantine's real stylesheet
  and the mutations are what stay. A Playwright spec that diffs a pruned and an unpruned build would need the
  unpruned build to exist, which doubles the demo build for one assertion.
