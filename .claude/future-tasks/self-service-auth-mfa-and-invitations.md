# Self-service MFA, invitation signup, and password reset

**Priority:** P1 · **Status:** open

`AuthPort` covers getting the current user, listing/inviting members, and switching the active org,
and there's already a working (if narrow) invite-acceptance flow — but nothing lets a person manage
their own account security or recover a forgotten password without an admin's help, and the existing
invite flow doesn't cover every case it needs to. For most products shipping to real users, these are
not optional extras; their absence is the gap.

**Need, as a bundle (the pieces depend on each other):**

- **Second factors.** `AuthUser` needs a `secondFactor` state (enabled only by a TOTP app or a phone
  number — recovery codes alone should never count as "enabled"). The port needs enrollment and
  removal for each factor type, and generation of single-use recovery codes gated on having a real
  factor already (never offered as a stand-alone factor). A TOTP implementation needs to be pure
  enough to run identically in a server adapter and a browser-side demo twin (RFC 6238 over Web
  Crypto, not a server-only library).
- **A client-side auth surface.** Everything above, plus password sign-in with a second-factor step
  and password reset by emailed code, needs a browser-side client port distinct from the
  request-scoped `AuthPort` — the account flows a real identity provider typically exposes only
  through client-side hooks, never a backend API `AuthPort` could wrap. Reset and signup both need
  server-enforceable password rules (length/character-class/maximum), not just client-side validation
  copy.
- **Self-service invitation acceptance, widened.** Today's flow (`AcceptInviteScreen`, the fake-mode
  name-only form; `RealAcceptInviteForm`, the real-mode Clerk-ticket signup) only has two states —
  valid or invalid — and treats every visitor as a brand-new person. It needs to become three
  distinct flows: a signed-out visitor landing on an invitation link who is ALREADY signed in as
  someone else (prompt sign-out first, rather than silently acting as the wrong person) or who needs
  to choose "I'm new" vs. "I already have an account"; creating a brand-new account from an invite
  (today's name-only form needs a password too, plus a seam for the app's own legal-acknowledgement
  UI, since that's product content the framework can't supply); and a signed-in person whose account
  already matches the invited address joining the team with one action — which nothing handles
  today, since the current flow has no notion of "you're already signed in as the right person". An
  invite's role must be checked against the set of roles an invite is actually allowed to grant
  (never silently assignable to something higher, like an admin role, by a non-UI caller) — that
  check belongs in one shared place both a real route and a demo/test twin call, not duplicated and
  liable to drift.

**Done looks like:** a person can enroll/remove a second factor and see it enforced at sign-in; a
reset-password flow works end to end without an admin; all three invitation-landing states render
correctly and a new account can complete signup through to being a team member; and every piece has
a demo-world twin so a tour or a static demo can walk through it with no real identity provider.

Evidence: `packages/keel/src/ports/auth.ts` (today's `AuthPort`, missing second-factor state),
`packages/keel/src/components/auth/accept-invite-screen.tsx` (today's name-only, valid/invalid-only
invite-acceptance flow) and `packages/keel/src/adapters/real/accept-invite-form.tsx` (its real-mode
Clerk-ticket counterpart), `packages/keel/src/components/auth/` more broadly (sign-in-screen,
user-menu, org-switcher — the components a client auth surface and new screens would sit alongside),
`packages/keel/src/core/abilities.ts` and `packages/keel/src/db/with-tenant.ts` (the authorization and
tenancy primitives any new invite/account routes would compose with, same as every existing one).
