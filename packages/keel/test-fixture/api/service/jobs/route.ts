import { abilityActorFromService, authorize } from 'keel/authz/authorize'
import type { ServiceIdentity } from 'keel/service-auth/verify'

/**
 * FIXTURE ROUTE — SCANNED, NEVER SERVED. See ../../dockets/route.ts for what this tree is.
 *
 * THIS FILE is the scan's MACHINE route: a caller that is not a person (a verified service key) making
 * a mutation, authorized like any other route by passing its machine actor to `authorize(...)`. Service
 * routes used to sit under a `service/` prefix exemption ("org-scoped by construction"); a machine
 * actor gave them a per-action check instead, so the exemption is gone and this route has to call
 * `authorize(...)` for real.
 */
const IDENTITY: ServiceIdentity = {
    kind: 'org-service',
    tenantId: 'harbor',
    tenantSlug: 'harbor',
    orgId: 'wharf',
    orgSlug: 'wharf',
}

export async function POST(): Promise<Response> {
    authorize(abilityActorFromService(IDENTITY), 'update', { type: 'Job', orgId: IDENTITY.orgId })
    return Response.json({ ok: true })
}
