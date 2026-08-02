# Architecture Decision Records

All thirteen decisions below are **Accepted** (approver: JP Slavinsky). They are the one-way doors — the
choices that shaped everything after them and are expensive to reverse — and they are not open for
relitigation in routine work. If new information genuinely challenges one, raise it with the approver.

The operating philosophy these decisions serve (thin slices, ports and adapters, hermetic dev, demo mode,
the one-app default) is in [../development-approach.md](../development-approach.md); the ADRs are the
specific commitments it produced.

**How an ADR changes.** A body is a dated record of a decision. It is amended by appending a **dated
addendum**, never by editing what it said — so the record of _why_ survives even when the answer moves.
A decision that genuinely reverses gets a superseding ADR rather than a quiet rewrite. The bodies here
were consolidated at publication: each states the decision as it holds today, and the amendment rule
runs from that point, so an entry in the dated records citing "ADR-000N's addendum" means material that
now sits in the ADR body (see [../provenance.md](../provenance.md)).

ADR bodies are exempt from the doc-path gate (`tests/docs/doc-paths.test.ts`) that holds the rest of the
doctrine set to citing paths that exist. That exemption is what the append-only rule costs: text written
on one date cannot be re-pointed when a later date moves a directory, and correcting it would be exactly
the editing the rule forbids. For current locations, `CLAUDE.md` and the gated doctrine docs are
authoritative.

| #                                                   | Title                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| [0001](0001-hosting-lambda-web-adapter.md)          | Hosting: Next.js standalone on Lambda via Web Adapter            |
| [0002](0002-data-layer-kysely-pglite.md)            | Data layer: Kysely, pglite locally, Aurora in production         |
| [0003](0003-auth-clerk-headless-custom-ui.md)       | Auth: Clerk headless behind a port, one custom UI                |
| [0004](0004-tenancy-rls.md)                         | Tenancy: tenant_id everywhere + Postgres RLS                     |
| [0005](0005-ui-mantine-panda.md)                    | UI: Mantine + Panda CSS                                          |
| [0006](0006-isomorphic-core.md)                     | Isomorphic core and router-agnostic screens                      |
| [0007](0007-repo-shape.md)                          | Repo shape: pnpm monorepo with an `apps/` tree                   |
| [0008](0008-i18n-next-intl.md)                      | i18n: next-intl, en + es                                         |
| [0009](0009-llm-anthropic.md)                       | LLM: Anthropic behind a port, pinned models                      |
| [0010](0010-observability-sentry-posthog.md)        | Observability: Sentry errors + PostHog analytics                 |
| [0011](0011-email-mailgun.md)                       | Email: Mailgun, react-email, the port as the catch-point         |
| [0012](0012-framework-app-line-and-registration.md) | The framework/app line: registration through the app-config seam |
| [0013](0013-upstream-updates-fork-and-merge.md)     | Upstream updates: publishable-shaped, distributed by fork/merge  |
