import { abilityActorFromService, authorize } from 'keel/authz/authorize'
import type { ServiceIdentity } from 'keel/service-auth/verify'

/**
 * FIXTURE ROUTE — SCANNED, NEVER SERVED. See ../../dockets/route.ts for what this tree is.
 *
 * THIS FILE is the scan's MACHINE route: a caller that is not a person (a verified service key) making
 * a mutation, authorized like any other route by passing its machine actor to `authorize(...)`. Service
 * routes used to sit under a `service/` prefix exemption ("org-scoped by construction"); a machine
 * actor gave them a per-action check instead, so the exemption is gone and this route has to call
 * `authorize(...)` for real. It must ALSO contain `withServiceCaller`, the wrapper that verifies the
 * caller and builds that actor: the scan requires both under `service/`.
 *
 * The wrapper is a local stand-in rather than an import: `withServiceCaller` is app-side machinery
 * (each app composes it over its own respond helpers), so there is no framework symbol to reach for.
 */
const IDENTITY: ServiceIdentity = {
    kind: 'org-service',
    keyId: 'wharf-key',
    tenantId: 'harbor',
    tenantSlug: 'harbor',
    orgId: 'wharf',
    orgSlug: 'wharf',
}

const withServiceCaller = (handler: (identity: ServiceIdentity) => Promise<Response>): Promise<Response> =>
    handler(IDENTITY)

export async function POST(): Promise<Response> {
    return withServiceCaller(async (identity) => {
        authorize(abilityActorFromService(identity), 'update', { type: 'Job', orgId: identity.orgId })
        return Response.json({ ok: true })
    })
}
