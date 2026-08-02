import { isSimulated } from 'keel/adapters/index'
import { listWorldAuditEvents } from 'keel/adapters/fake/audit'
import { withPortErrors } from '../../respond'

/**
 * Simulator-mode gate, not a role gate (design invariant): 404s outside simulated mode, first line, no
 * role check. Feeds the Events tab's read-only "Audit trail — product record" section — the
 * cross-tenant god view of the durable audit_events table, distinct from the analytics
 * events shown above it. Audit is compliance-grade PRODUCT data (per-tenant, in pglite), surfaced
 * read-only here; it is never mutated through Simulator.
 */
export async function GET(): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        const audit = await listWorldAuditEvents()
        return Response.json({ audit })
    })
}
