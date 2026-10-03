# Account erasure needs to be a cross-cutting port capability

**Priority:** P1 · **Status:** open

Any product that holds personal data eventually needs to delete an account's data on request, and
that need touches more than one port at once: find the account (not necessarily the caller's own —
an admin acting on someone else's), delete their auth record, delete anything they stored, revoke
their pending invitations, and tear down anything provisioned for them. Today no port expresses any
half of this.

**Need**, one capability spanning three ports:

- **`AuthPort`**: `findAccount(idOrEmail)` — resolve by id or by any address, case-insensitively,
  returning every address on the account so a caller knows what else to erase; `deleteAccount(userId)`
  — idempotent, an unknown id is a no-op; `revokeInvitesForEmail(email)` — revoke every pending
  invitation to that address across every org, returning the count revoked (and paginate correctly —
  an org with more invitations than a page's worth needs every page scanned, or revocation is
  silently partial).
- **`StoragePort`**: `delete(keys)` (see the separate storage-port task) — the actual object cleanup
  an account erasure needs once the account record itself is gone.
- **Any provisioning port** (e.g. a workspace port, see its own task): a `deleteOwner`-shaped method
  — remove every resource an identity owns, looked up by a stable join key like email rather than a
  derived username, and safe to call even when the identity owns nothing.

None of these carry their own authorization — the capability finds and deletes; the caller (an admin
route) decides whether this request is allowed.

Evidence: `packages/keel/src/ports/auth.ts` (today's `AuthPort`, missing all three methods above),
`packages/keel/src/ports/storage.ts` (missing `delete`).
