# Demo size budgets are one dependency bump from red

**Priority:** P3 · **Status:** open — becomes P1 the moment either budget actually goes red
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
