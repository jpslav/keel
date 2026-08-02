# ADR-0003 — Auth: Clerk headless behind a port, one custom UI

- Status: Accepted
- Approver: JP Slavinsky
- Date: 2026-08-01

## Context

Dev builds must behave like production (`docs/development-approach.md`), and auth is where that
principle is usually abandoned first: a dev-only stub screen beside a vendor's prebuilt components means
the sign-in path you develop against is not the sign-in path users get, and the difference surfaces at
the worst possible moment. So the question is not "which auth vendor" but "how little of the vendor's
surface can the app depend on".

Managed auth is worth buying — session handling, password reset, MFA, organization membership and invite
flows are a large amount of security-sensitive code nobody should write again. Clerk supplies all of it
and, importantly, exposes it through headless hooks as well as prebuilt components, which makes it
possible to buy the mechanism without buying the UI.

## Decision

**Clerk sits behind a deliberately narrow `auth` port (`packages/keel/src/ports/auth.ts`), and there is
exactly one auth UI — custom Mantine components used in every mode.**

The real adapter wraps Clerk's headless APIs. The fake adapter implements the same port locally: a
people picker that issues a signed session cookie, so the simulated world signs in through the same
interface the real one does. The fake is a first-class adapter, not a stub.

**The port is sized to the app, never to Clerk's API.** It is `getCurrentUser` / `requireUser` /
`requireRole`, `signInPath` / `signOut`, `updateProfile`, `listMembers(orgSlug)` / `createInvite`, and
`listMyOrgs` / `setActiveOrg`. Growing it to mirror a vendor method the app does not call is the failure
mode this shape exists to prevent.

**We own the component surface Clerk would otherwise provide.** `SignInScreen`, `UserMenu`,
`OrgSwitcher`, `ProfileScreen`, `OrgScreen` (member list plus pending invites) and `AcceptInviteScreen`
ship in `packages/keel/src/components/auth/` and the framework screens beside them. Deeper features —
MFA enrollment, sessions/devices, connected accounts, avatar upload — are documented seams rather than
stubs; `docs/auth-ui-playbook.md` maps every Clerk component to its house surface and names the Clerk API
a seam would call.

`<ClerkProvider>` stays adapter-confined (`packages/keel/src/adapters/real/providers.tsx`), real-mode
only, and renders no UI. It is present as the clerk-js runtime for slotted vendor forms and future client
calls, nothing more.

Clerk instances are cutover items: a development instance serves `pnpm dev:real` and real previews, a
production instance is production-only (`auth-dev` and `auth-prod` in `docs/cutover-checklist.md`).

### Tenant ≠ organization

Two concepts that "tenant" alone conflates, and the split is load-bearing everywhere else in the repo:

- **Tenant** = one customer's entire hosted site, separately branded and URL'd. It is **ambient**: it
  comes from the deployment and the session, and users — even tenant admins — never see or switch to
  another tenant. `AuthUser.tenantSlug` is that ambient claim, and it drives per-tenant theming
  (ADR-0005). It is never user-switchable in the product. Cross-tenant control would be a backplane, not
  product UI.
- **Organization** (`org` in code; **"team"** in user-facing copy) = a group of users **within** one
  tenant, GitHub-style: one login, membership in several orgs, and switching orgs switches whose data you
  see. This maps 1:1 onto Clerk Organizations — one Clerk instance per tenant, so an org slug _is_ the
  Clerk org slug and there is no mapping layer. Role is per-org membership; `AuthUser.role` is the role
  in the active org.

The tenant is the **hostile-isolation** boundary and is enforced by row-level security (ADR-0004); the
org is a **collaboration** boundary among mutually-trusting users of one customer, and is an app-level
filter. Those are different promises and they get different mechanisms.

**Naming rule:** identifiers and data use `org`/`organization` — Clerk's word, so no translation layer
exists to get wrong. User-facing copy says "team", in message values only.

In the simulated world, crossing tenants is a Simulator capability (become a person whose home tenant
differs), never a product surface.

### Reusing Clerk's own UI was evaluated and rejected

Adopting Clerk's MIT-licensed `@clerk/ui` components, or `@clerk/elements`, directly was considered.
Rejected on two grounds. `@clerk/ui` is an _internal_ package whose every component binds to a live
clerk-js client through `@clerk/shared/react` hooks and internal contexts — faking that reintroduces the
entire Clerk API surface the port exists to hide — and its visual layer (emotion `styledSystem`,
`customizables`, its own localization) is not cleanly extractable. `@clerk/elements`, the headless
option, is beta and unsupported as of Clerk Core 3. So we **mine Clerk's component anatomy as a design
reference** and re-express it in Mantine, which is what `docs/auth-ui-playbook.md` is.

### Machine callers are a sibling seam, not this port

This ADR and the `auth` port scope to **human, session-cookie callers only**. Services that call the app
— rather than people who sign into it — are verified by `packages/keel/src/service-auth/`: per-org RS256
tokens checked against app-owned `service_keys` rows, plus a shared-secret webhook verifier. That lives
_beside_ the port, not inside it, because it verifies app-owned signatures over app-owned state rather
than wrapping a vendor, and because `ServiceIdentity` is a genuinely different type from `AuthUser`.
Folding it in would have made the port mean "anything that authenticates", which is not a seam.

## Consequences

- Identical auth UX in dev, demo, E2E and production, because there is only one implementation of it.
- Auth features arrive at the speed we build them. That is the accepted cost of owning the UI, and the
  playbook exists to make each one a recipe rather than a research project.
- The port stays small only if it is defended. Every addition should name the app call site that needs
  it.
- **Deferred auth features have a landing pad, not just a note.** The access-gate class
  (`packages/keel/src/core/gates.ts`) is a condition an actor must satisfy before proceeding, evaluated
  once in the protected layout, with a resolution flow and block-or-advisory behavior. MFA enrollment is
  a gate of exactly that shape: a future rider adds an `mfaEnrolled` fact and an `mfa:enroll` gate whose
  `resolutionPath` points at the Clerk enrollment flow, with no change to the evaluator or the layout
  hook. Clickwrap agreements are the worked example that shipped; email verification, onboarding,
  suspension and billing entitlements ride the same seam.
