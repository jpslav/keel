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

3. **No production-usable "no tenant yet" lookup exists for a service-auth caller specifically.**
   `packages/keel/src/db/tenant-lookup.ts`'s `tenantIdForSlug` and `org-lookup.ts`'s `orgIdForSlug`
   resolve WITHIN a tenant a caller already named. The query shape for "every tenant" already
   exists, twice, inline — `packages/keel/src/db/schedules.ts` and `packages/keel/src/db/webhooks.ts`
   each run their own `selectFrom('tenants').select('id').execute()`, because a background job runner
   has no caller tenant either — but neither is a shared, callable function. And `org-lookup.ts`
   already has `listOrgsForWorld` (every org across every tenant, joined to its tenant slug) — almost
   exactly the cross-tenant slug search a service-auth caller needs — but its only caller
   (`apps/showcase`'s simulator inbound route) gates it to simulated mode, so it isn't usable by a
   real-mode caller today. Need: factor the existing every-tenant query into a shared function in
   `tenant-lookup.ts`, and make an equivalent of `listOrgsForWorld` available to a real-mode,
   no-tenant-context caller — extending two proven patterns, not inventing a new one.

Evidence: `packages/keel/src/service-auth/webhook.ts` (hard-coded secret name),
`packages/keel/src/service-auth/mailgun.ts` (the verifier shape a second scheme would follow),
`packages/keel/src/db/tenant-lookup.ts` and `packages/keel/src/db/org-lookup.ts` (today's
tenant-scoped lookups, and `listOrgsForWorld`'s simulated-mode-only cross-tenant query),
`packages/keel/src/db/schedules.ts` and `packages/keel/src/db/webhooks.ts` (today's two inline,
un-shared "every tenant id" queries).
