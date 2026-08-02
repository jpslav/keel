# ADR-0008 — i18n: next-intl, en + es

- Status: Accepted
- Approver: JP Slavinsky
- Date: 2026-08-01

## Context

Retrofitting internationalization is one of the most expensive things a codebase can be asked to do:
locale routing touches every URL, message extraction touches every component, and the parts that get
missed are exactly the parts nobody reads in the primary locale — error states, empty states, aria
labels. Carrying two locales from the first commit costs a rounding error and keeps the plumbing honest,
because a second locale is a test that fails loudly.

The static demo (ADR-0006) adds a constraint: it must build as a static export, which works with
next-intl only if pages use `[locale]` routing with `generateStaticParams` and `setRequestLocale`. That
has to be a habit from day one, not a migration.

## Decision

**next-intl with `[locale]` segment routing** over `en` and `es`. Locale negotiation runs in `proxy.ts`
(Next 16's rename of `middleware.ts`) via next-intl's middleware. Every page calls
`generateStaticParams` + `setRequestLocale`, so all pages stay static-export-compatible for the demo
shell.

**No hard-coded UI strings.** `react/jsx-no-literals` runs over every component tree — both apps' and the
framework's. Because that rule cannot see inside props, a companion rule bans string literals in the
attributes that carry user-visible copy: `aria-label`, `placeholder`, `title`, `alt`. Those are exactly
the strings a monolingual reviewer never notices.

**The catalog is split along the framework/app line** (ADR-0012), and the split is physical rather than
conventional:

- framework namespaces ship in `packages/keel/src/i18n/messages/{en,es}.json`;
- app namespaces ship in `apps/<app>/messages/{en,es}.json`;
- `keel/i18n/messages.ts` deep-merges them at all three load sites — the next-intl request config, the
  static demo shell, and Ladle.

The two halves are **disjoint and together exactly partition** the merged catalog, and that is
test-enforced rather than agreed. So is parity: the merged `en` and `es` catalogs must be key- and
placeholder-identical, and the framework half must be internally parity-clean on its own, so a framework
change cannot be rescued by an app's catalog.

Spanish may start as placeholder translation. The plumbing is what has to be complete.

## Consequences

- Every page renders in both locales in the E2E smoke suite, so a missing key is a failing test rather
  than a bug report.
- One seeded person is Spanish-locale in each app, which keeps localization visible in ordinary dev use
  instead of only under a flag.
- **An app that registers a framework-mechanism vocabulary must supply its own copy for it.** Where a
  framework subsystem renders app-registered kinds — notifications are the worked case — the framework
  declares a copy contract and stamps a namespace on what it returns, so app copy resolves in the app's
  catalog. A framework catalog carrying one app's strings would make the partition a lie.
- The framework catalog holds **no product name**. One shared catalog cannot name two products, so
  `AppHeader` and `DemoShell` take a required `appName` prop and each app passes its own. It is required
  rather than optional because the optional version shipped a bug: the fallback resolved, so nothing
  failed, and every signed-in header rendered the wrong product name. A default that resolves is
  indistinguishable from a default that is right.
