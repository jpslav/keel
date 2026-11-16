# Personal API tokens as a framework capability

**Priority:** P2 · **Status:** open
**Found by:** `feat/authorize-non-session-actors`, 2026-11-16, from an adopter's CLI tokens.

keel can now AUTHORIZE a person who holds a personal API token:

- `abilityActorFromCredential` re-reads their standing on every call;
- the token's kind registers as an `AppPersonCredentialKind`;
- the audit trail records `credential_kind` and `credential_id`.

What keel does not have is the token itself. The first adopter (the sharing site's console) built
issuance, storage, verification and revocation in its own app. It looks like a capability most
products of this kind need: a CLI, a script or an agent acting as a signed-in person. That is the
universality test in `docs/development-approach.md`, and it plausibly passes.

**The shape the console arrived at** (evidence, not a spec):

- **Token format.** `<app>_<tenant slug>_<43 base64url chars>`. The tenant slug is not secret; it lets
  the row be found under RLS before the caller is known (`tenantIdForSlug`, then `withTenant`).
  This sidesteps `service-auth-flexibility.md`'s third item, a lookup before the tenant is known.
- **Storage.** A tenant-scoped table: the owner's user id, the org the approving session was acting in,
  a SHA-256 of the token (unique across tenants), and `created_at`, `last_used_at` and `revoked_at`.
  Never the token itself.
- **Issuance.** A CLI login a browser SESSION approves. A token cannot mint its successor, and
  approving from the operator org is refused, though keel would ignore `manageAll` for a token anyway.
- **Revocation.** Per token, and all of a person's tokens when they are removed. Removal already fails
  the next call through `getMember`, so revocation here is tidiness and audit.

**If keel takes it:**

- `api-token` becomes a framework person credential kind.
- The table becomes a framework migration with its RLS proof.
- A verifier returns `{ tenantId, org, userId, tokenId }` for `abilityActorFromCredential`.
- The profile screen gains a token list.
- The CLI-login exchange may stay app-shaped.

**Decide first** whether per-token scopes belong in v1. Narrowing by credential KIND already works in
the app's rules. A per-token cap has a marked place in `defineAbilitiesFor`, but nothing needs it yet.
