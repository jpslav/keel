---
description: Screenshot every screen in both locales and tenant themes, then critique against design heuristics
---

1. With `pnpm dev` running, drive the app via Playwright or browser tools. Screenshot every route
   listed in `apps/showcase/tests/e2e/a11y.spec.ts`: en + es; for protected pages, both tenant themes (sign in as the
   admin person and use the tenant switcher — the tenants differ in primary color AND radius by
   design). Save screenshots to the session scratchpad, never into the repo.
2. Also capture: 375px mobile width for home/signin/dashboard, and each Ladle story (`pnpm ladle`) if
   the screen has one.
3. Critique each screenshot against: Mantine spacing-scale consistency, visual hierarchy (one clear
   primary action per screen), Spanish strings (~25% longer) overflowing buttons/labels,
   truncation/wrapping of long user data, empty states, loading states, theme tokens actually applied
   (no hardcoded colors).
4. Done when you've produced a ranked findings report (screen, locale/theme, issue, suggested fix)
   citing screenshot paths. Review only — do not change code unless asked.
