import { db } from 'keel/adapters/index'
import { AuthRequiredError } from 'keel/ports/errors'
import { type ServiceIdentity, verifyServiceCaller } from 'keel/service-auth/verify'
import { withPortErrors } from '../respond'

/**
 * Wraps a service-caller route handler. Verifies the M2M JWT FIRST — a failed verify is an opaque
 * 401 `{ error: 'unauthorized' }`, never a hint about which check failed — then runs the handler
 * inside withPortErrors, whose mappings include the one these callers care about: a rejected
 * state-machine hop (InvalidTransitionError) becomes 409 `{ error: 'invalid-transition', from, to }`
 * so the caller learns the job already moved on. The verified identity is threaded into the handler
 * as ctx.identity.
 *
 * These routes ship in REAL builds (unlike /api/simulator/*). Never add `export const runtime =
 * 'edge'`: verification uses node:crypto and the db adapter uses node fs/net.
 *
 * P defaults to a SegmentParams-compatible shape so both dynamic ([id]) and static service routes
 * satisfy Next's route-handler type check; dynamic routes pass their params type explicitly.
 */
export function withServiceCaller<P = Record<string, string>>(
    handler: (ctx: { identity: ServiceIdentity; request: Request; params: P }) => Promise<Response>,
): (request: Request, context: { params: Promise<P> }) => Promise<Response> {
    return async (request, context) => {
        let identity: ServiceIdentity
        try {
            identity = await verifyServiceCaller(db, request)
        } catch (error) {
            if (error instanceof AuthRequiredError) return Response.json({ error: 'unauthorized' }, { status: 401 })
            throw error
        }
        const params = (await context?.params) as P
        // withPortErrors already maps InvalidTransitionError → the 409 body described above.
        return withPortErrors(() => handler({ identity, request, params }))
    }
}
