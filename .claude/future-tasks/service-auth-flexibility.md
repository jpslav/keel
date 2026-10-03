# Service-auth: configurable secret names, a second signature scheme, and pre-tenant lookups

**Priority:** P2 · **Status:** open

Three related gaps a machine caller (not a signed-in person) runs into:

1. **The webhook secret's env-var name is hard-coded.** `packages/keel/src/service-auth/webhook.ts`'s
   `expectedSecret()` always reads `WEBHOOK_SECRET` in real mode. A product that already has its own
   deployed shared secret under a different env-var name has to duplicate the timing-safe verifier
   instead of reusing it. Need: let the secret's env-var name be a parameter, defaulting to today's
   name so every existing caller is unaffected.

2. **Only one inbound-signature scheme exists.** The shared-secret bearer scheme above is the only
   verification shape in `packages/keel/src/service-auth/`. A caller using a Standard Webhooks
   (Svix-style) signed envelope — timestamp + signature header, HMAC over `id.timestamp.body` — has no
   framework verifier to reuse and would hand-roll one per app. Need: a second verifier in the same
   module family, following the existing mailgun-style verifier's shape (a dev secret in simulated
   mode, an env secret in real mode).

3. **Every lookup assumes the caller already knows its tenant.** `packages/keel/src/db/tenant-lookup.ts`
   and `packages/keel/src/db/org-lookup.ts` resolve a tenant/org by slug WITHIN a tenant a caller
   already named. A caller authenticated by a shared secret that names no tenant at all, or by an
   unverified claim naming only a slug (unique within a tenant, not globally), has no way to search
   across every tenant to find which one contains the row it names. Need: a tenant-agnostic lookup
   (every tenant id) and a slug lookup across every tenant's orgs, as the explicit "no tenant context
   yet" counterpart to the existing scoped lookups.

Evidence: `packages/keel/src/service-auth/webhook.ts` (hard-coded secret name),
`packages/keel/src/service-auth/mailgun.ts` (the verifier shape a second scheme would follow),
`packages/keel/src/db/tenant-lookup.ts` and `packages/keel/src/db/org-lookup.ts` (today's
tenant-scoped-only lookups).
