# AuthPort needs team-management methods

**Priority:** P2 · **Status:** open

`AuthPort` (`packages/keel/src/ports/auth.ts`) can list members, create an invite, and read the
caller's own orgs — but nothing on the port lets an admin actually manage a team day to day: change
someone's role, remove them, revoke a pending invite before it's accepted, or rename the org itself.
An app wanting basic team administration has to build all of it outside the port.

**Need**, four additions to `AuthPort`:

- `updateMemberRole(orgSlug, userId, role)` and `removeMember(orgSlug, userId)` — the two ordinary
  team-management actions, each naturally self-refusing on the caller's own id (nobody demotes or
  removes themselves through this path).
- `revokeInvite(orgSlug, inviteId)` — withdraw a pending invitation before it's claimed.
- `updateOrgName(orgSlug, name)` — **never a direct write to a local `name` column.** Wherever the
  identity provider is the source of truth for an org's identity, a rename has to go through it (an
  API call to that provider), not around it, or the two records drift.

**Related, smaller need:** a way to resolve an org's current display name for a caller with NO
membership relationship to that org at all — distinct from the caller's own `listMyOrgs()` (which
only returns orgs the caller belongs to). A cross-org or cross-tenant caller (a paired external
system naming another org by slug) has no way to read its name today.

Evidence: `packages/keel/src/ports/auth.ts` (today's `AuthPort`, missing all of the above),
`packages/keel/src/core/abilities.ts` (the `Membership` CASL rule a role-change/remove/revoke UI
would authorize against).
