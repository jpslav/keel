# Locale set should be app-configurable, not hard-coded

**Priority:** P2 · **Status:** open

`LOCALES`/`DEFAULT_LOCALE` are a hard-coded `['en', 'es']` / `'en'` in `packages/keel/src/core/locale.ts`.
Any app that wants a different active locale set — fewer locales, more, or a different default — has
to edit framework source rather than configure it.

**Need:** source `LOCALES`/`DEFAULT_LOCALE` from the app-config seam, the way other per-app choices
already are (an app-config module an app's own composition registers), instead of a literal in
framework source. Keep the invariants a generic `LOCALES` must satisfy regardless of app (non-empty,
contains `DEFAULT_LOCALE`, no duplicates) as framework-level tests against the seam's contract shape,
not against one concrete locale list.

**Paired UI need:** `packages/keel/src/components/profile-screen.tsx`'s language switch (a `Select`)
renders unconditionally today. Once locales are configurable, an app with exactly one active locale
has a single-option switch doing nothing useful — it should render only when more than one locale is
configured. The Simulator panel's own locale control should get the same treatment for consistency.

Evidence: `packages/keel/src/core/locale.ts` (current hard-coded set), `packages/keel/src/components/profile-screen.tsx`
(the language switch), `packages/keel/src/components/simulator/simulator-panel.tsx` (the Simulator's own
locale control).
