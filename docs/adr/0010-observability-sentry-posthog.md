# ADR-0010 — Observability: Sentry errors + PostHog analytics

- Status: Accepted
- Approver: JP Slavinsky
- Date: 2026-08-01

## Context

Error tracking and product analytics are different jobs, and the tools that do both do one of them
noticeably worse. Sentry's error tracking — stack grouping, release association, source maps, the
on-call workflow around an issue — is the mature option and has no product analytics. PostHog's product
analytics and feature flags are the mature option there, and its error tracking is younger than Sentry's.

There is a second, structural difference between the two that decides how each is wired. Error tracking
is **instrumentation**: it has to be installed before the app's own code runs, wrap the framework's error
boundaries, and see failures the app never catches. Analytics is **something the app calls**: a `capture`
here, a flag read there. Those are not the same shape, and forcing both behind a port would mean either a
port nobody can implement or instrumentation that misses the errors it exists to catch.

## Decision

**Sentry for error tracking, wired as instrumentation.** `@sentry/nextjs`, the app's
`instrumentation.ts` / `instrumentation-client.ts`, and `withSentryConfig` in its `next.config.ts`. It is
**inert without a DSN**, so a hermetic dev run initializes nothing and phones nowhere — and because it is
inert, an app can leave it out entirely: `apps/showcase` wires it, `apps/starter` deliberately does not,
which is what keeps "opt-in" true rather than assumed.

Event scrubbing is deliberately **not** in the vendor's hands:
`packages/keel/src/observability/scrub.ts` is pure TypeScript that strips cookies, authorization and
API-key headers, query strings, and user email/IP before anything leaves the process. Being pure means it
unit-tests without the SDK, which matters because it is the one piece here whose failure is a data
incident rather than a missing graph.

**PostHog for product analytics and feature flags, strictly behind the `analytics` port** (`capture`,
`isFlagEnabled`). The real adapter is enabled in staging and production only; the no-op fake runs
everywhere else, so nothing in dev, demo or E2E emits telemetry.

**A health endpoint plus basic CloudWatch alarms** (server errors, throttles) in the CDK stack — the
floor below both vendors, and the thing that still works when a vendor is down.

Both are cutover items (`errors`, `analytics` in `docs/cutover-checklist.md`), and the Sentry
organization and project names are placeholders in the app's `config/params.ts`. No account, DSN or
project name for any real organization appears in this repo.

## Consequences

- Two vendors, each doing only the job it is best at, and neither of them keyed until cutover.
- The asymmetry is the point and worth stating so it does not look like an oversight: **Sentry is
  instrumentation, PostHog is a port.** The vendor-SDK lint (`@sentry/*` and `posthog-*` only inside
  `packages/keel/src/adapters/`) covers both wherever it can reach, so "not a port" does not mean "not
  fenced". It cannot reach everywhere, and the exception is worth naming rather than discovering: an
  app's `next.config.ts` imports `withSentryConfig` directly, because a build-time config must, and it
  sits outside the fence's `apps/*/src/**` glob by construction — the same class of exception ADR-0012
  records for the two call sites that reach keel by file path. Everything at request time goes through
  `keel/adapters/sentry/*`.
- Feature flags arriving through the analytics port means the simulated world can drive them without a
  vendor: the Simulator's flag registry is the same seam, so a flag is demonstrable before anyone has a
  PostHog project.
- Scrubbing is code this repo owns and must keep current. A new sensitive header is a change here, not a
  vendor setting.
