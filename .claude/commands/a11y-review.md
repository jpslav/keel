---
description: Run the axe sweep, then review keyboard navigation and semantics beyond what axe can see
---

1. Run the axe sweep — `apps/showcase/tests/e2e/a11y.spec.ts` — with
   `pnpm --filter showcase exec playwright test a11y` (the positional argument is a filter, not a
   path, so it is run from the app that owns the Playwright config). Fix any violations first — axe
   findings are never "noise". If Playwright complains about a missing browser, run
   `pnpm exec playwright install chromium` once, then retry.
2. With `pnpm dev` up, go beyond axe using Playwright or browser tools:
    - Keyboard-only pass across signin → dashboard → tenant switch → invite flow: tab order matches
      visual order, focus is visible at every stop, no traps, Escape closes the user menu and the
      tenant switcher.
    - Focus management after tenant switch and form submits (invite, profile save) — focus must not
      silently reset to `body`.
    - Semantics: one `h1` per page, no skipped heading levels, landmarks present, tables in `/org` and
      in the Simulator panel's tabs have real headers, async feedback (invite-sent, profile-saved,
      greeting) is announced via `aria-live`/`role=status`.
    - Contrast judgment on BOTH tenant themes and BOTH locales (`docs/build-notes.md` records why
      `primaryShade: 8` exists — shade 6 failed WCAG).
3. Done when the axe spec is green and you've produced a ranked findings list (WCAG criterion, page,
   suggested fix). Apply one-line fixes directly; list larger ones instead of fixing them. No new
   `eslint-disable` comments.
