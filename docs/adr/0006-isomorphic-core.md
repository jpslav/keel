# ADR-0006 — Isomorphic core and router-agnostic screens

- Status: Accepted
- Approver: JP Slavinsky
- Date: 2026-08-01

## Context

Domain logic should be portable and testable without a framework harness. That much is ordinary taste.
What makes it a decision rather than a preference here is the static demo: the scaffold ships a
single-file build that runs from `file://`, so a stakeholder can be emailed one HTML file and click
through the whole product with no server, no network and no credentials.

That target is unforgiving. On the `file://` origin, App Router client navigation cannot work — the
router fetches RSC payloads, and browsers block those requests on a file origin. So every screen has to
be renderable outside Next's routing, or the demo is not buildable at all. Discovering that after the
screens are written is a rewrite; deciding it up front costs nothing.

## Decision

**`packages/keel/src/core` is pure TypeScript.** No React, no Next, no next-intl, no Mantine —
lint-enforced by a `no-restricted-imports` block scoped to that directory. It holds the rules: abilities,
roles, job and schedule vocabulary, state machines, notifications, webhook signing, keyset pagination,
gates.

**Screens are router-agnostic.** Framework screens live in `packages/keel/src/components`, app screens in
`apps/<app>/src/components`, and files under `apps/<app>/src/app` are thin wrappers that resolve params,
fetch, and render a screen. Putting logic in a route file is not lint-enforced — no rule can tell a
thin wrapper from a fat one — so it is held by review and by the static demo, which cannot build a
screen whose logic lives in a Next route file.

**The static demo is a hash-routed single-entry shell** built from the same screens over browser fakes.
`packages/keel/src/demo-static/` owns the hash router, the in-memory framework world and the shell; each
app supplies only its own rows and cards (`apps/<app>/src/demo-static/app.tsx`).

## Consequences

- Unit tests of domain logic need no framework harness, and run in milliseconds.
- The thin-wrapper discipline is what keeps the `file://` demo tractable. It is enforced because the
  failure mode is silent: a screen that reaches for `useRouter` works perfectly in the app and breaks
  only in the artifact nobody builds until the day they need it.
- Every capability therefore ships twice — the real path and its in-memory twin — which is a real cost,
  paid deliberately. The twin is small because the framework's half is shared; an app with one table
  writes about seventy lines of it.
- `pnpm ladle` can render screens in isolation for the same reason the demo can: nothing in a screen
  depends on how it was routed to.
