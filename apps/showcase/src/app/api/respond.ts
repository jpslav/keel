import { InvalidTransitionError } from 'keel/core/state-machine'
import { AuthRequiredError, ForbiddenError, NotFoundError } from 'keel/ports/errors'

/**
 * Maps port errors to HTTP for route handlers. A rejected state-machine hop (InvalidTransitionError)
 * becomes 409 `{ error: 'invalid-transition', from, to }` — the SAME body the service wrapper returns
 * (src/app/api/service/respond.ts) — so a product mutation that lost a lifecycle race (e.g. accepting
 * an already-decided escalation, or a PATCH that asks a ticket for a hop its machine forbids) reports
 * it identically.
 */
export async function withPortErrors(fn: () => Promise<Response>): Promise<Response> {
    try {
        return await fn()
    } catch (error) {
        if (error instanceof AuthRequiredError) return Response.json({ error: 'unauthorized' }, { status: 401 })
        if (error instanceof ForbiddenError) return Response.json({ error: 'forbidden' }, { status: 403 })
        if (error instanceof NotFoundError) return Response.json({ error: 'not found' }, { status: 404 })
        if (error instanceof InvalidTransitionError) {
            return Response.json({ error: 'invalid-transition', from: error.from, to: error.to }, { status: 409 })
        }
        throw error
    }
}
