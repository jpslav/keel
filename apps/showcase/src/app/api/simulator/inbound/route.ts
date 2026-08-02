import { db, isSimulated } from 'keel/adapters/index'
import { listAllPeople } from 'keel/adapters/fake/auth'
import { DEMO_INBOUND_DOMAIN } from 'keel/core/inbound-email'
import { listInboundForWorld } from 'keel/db/inbound-email'
import { listOrgsForWorld } from 'keel/db/org-lookup'
import { inboundHandlers } from 'keel/inbound-email/handlers'
import { withPortErrors } from '../../respond'

/**
 * Simulator inbound-email view + compose options. Simulator-mode gate, not a role gate (the
 * Mail-tab design invariant): 404 outside simulated mode, first line. Returns the cross-tenant inbound list
 * (the world's received messages) plus the pickers the "compose inbound" affordance needs — every
 * world org (with its tenant), every person's address, the registered handler slugs, and the fake-world
 * domain intake addresses are built under.
 */
export async function GET(): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        const inbound = await listInboundForWorld(db)
        const orgs = await listOrgsForWorld(db)
        const people = listAllPeople().map((p) => ({ email: p.email, name: p.name }))
        return Response.json({
            inbound,
            orgs,
            people,
            handlers: Object.keys(inboundHandlers),
            domain: DEMO_INBOUND_DOMAIN,
        })
    })
}
