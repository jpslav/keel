import { abilityActorFromService, authorize } from 'keel/authz/authorize'
import { withServiceCaller } from '../../stand-ins'

/**
 * FIXTURE ROUTE — SCANNED, NEVER SERVED. See ../../dockets/route.ts for what this tree is.
 *
 * THIS FILE is the scan's MACHINE route: a caller that is not a person (a verified service key) making
 * a mutation, authorized like any other route by passing its machine actor to `authorize(...)`. Service
 * routes used to sit under a `service/` prefix exemption ("org-scoped by construction"); a machine
 * actor gave them a per-action check instead, so the exemption is gone and this route has to call
 * `authorize(...)` for real. It must ALSO be wrapped by `withServiceCaller`, the wrapper that verifies the
 * caller and builds that actor: the scan requires both under `service/`, per verb, so the handler is itself
 * the call (`export const POST = withServiceCaller(…)`), the shape the showcase's service route has.
 *
 * `withServiceCaller` is imported from ../../stand-ins.ts, for the reason given there.
 */
export const POST = withServiceCaller(async ({ identity }) => {
    authorize(abilityActorFromService(identity), 'update', { type: 'Job', orgId: identity.orgId })
    return Response.json({ ok: true })
})
