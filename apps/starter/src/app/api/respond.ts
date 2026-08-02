import { AuthRequiredError, ForbiddenError, NotFoundError } from 'keel/ports/errors'

/** Maps port errors to HTTP for this app's route handlers. */
export async function withPortErrors(fn: () => Promise<Response>): Promise<Response> {
    try {
        return await fn()
    } catch (error) {
        if (error instanceof AuthRequiredError) return Response.json({ error: 'unauthorized' }, { status: 401 })
        if (error instanceof ForbiddenError) return Response.json({ error: 'forbidden' }, { status: 403 })
        if (error instanceof NotFoundError) return Response.json({ error: 'not found' }, { status: 404 })
        throw error
    }
}
