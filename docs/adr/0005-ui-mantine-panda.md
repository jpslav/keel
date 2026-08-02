# ADR-0005 — UI: Mantine + Panda CSS

- Status: Accepted
- Approver: JP Slavinsky
- Date: 2026-08-01

## Context

A scaffold that ships screens has to pick a component kit, and the cost of picking two is paid forever:
two accessibility stories, two theming stories, two sets of idioms in review, and a growing surface where
the seams between them look wrong. The template also has a specific requirement most apps do not —
**per-tenant theming** — because a tenant is a separately branded site (ADR-0003), so the kit must expose
theming as data rather than as a build step.

Styling additionally has to survive the `file://` static demo (ADR-0006), which rules out anything
requiring a server at render time.

## Decision

**Mantine is the only component library**, with `@mantine/form` for forms. **Panda CSS** is the styling
system, run as build-time codegen. **Ladle** is the component workshop — it serves the framework's and
the app's stories, and the react-email templates.

**Per-tenant theming is a helper, not a build variant.** `getTenantTheme(tenantSlug)`
(`packages/keel/src/theme.ts`) reads the app's own seed rows and returns a `MantineThemeOverride` fed to
`MantineProvider`. Every seeded tenant carries a distinct theme so the seam stays exercised by ordinary
use rather than by a test. Two details in that helper are deliberate:

- **`primaryShade: 8`.** Mantine's default shade 6 fails WCAG AA 4.5:1 for white-on-primary at most hues,
  so filled buttons and badges would ship failing contrast for any tenant that picked one.
- **A non-default `defaultRadius` per tenant.** A tenant switch should be visibly a _theme_ switch —
  roundness changes, not only hue — so that a broken theming seam cannot hide behind Mantine's defaults
  looking fine.

The default tenant to theme by is read from the app's first seeded tenant, never named as a constant: a
framework constant spelling one app's slug is a weld, and the second consumer had to work around exactly
that.

## Consequences

- Panda adds a codegen step, wired into the root `prepare` script so it runs at install and `pnpm dev`
  stays hermetic.
- **No `next/font/google`** — it fetches from Google Fonts at build time, which breaks the hermetic
  build. This one _is_ lint-enforced, re-listed in every framework `no-restricted-imports` block. Use
  system fonts or `next/font/local`.
- The single-kit rule is enforced by dependency and by review, not by a lint rule. It stays true because
  `@mantine/core` is a `peerDependency` of `packages/keel` (ADR-0012) — the framework and the app must
  resolve one instance of it — so adding a second kit is a visible dependency decision rather than an
  import someone slipped in.
- Choosing one kit is what makes the "does this component belong in the framework?" question answerable
  at all: generic presentation is a recipe (`docs/recipes/list-kit.md`), and only components encoding a
  framework invariant ship in `packages/keel`.
