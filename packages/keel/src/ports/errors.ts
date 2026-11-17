/** Thrown by requireUser/requireRole when no one is signed in. Route glue turns this into a redirect. */
export class AuthRequiredError extends Error {
    constructor() {
        super('authentication required')
        this.name = 'AuthRequiredError'
    }
}

/** Thrown by requireRole when the signed-in user lacks the required role. */
export class ForbiddenError extends Error {
    constructor(message = 'forbidden') {
        super(message)
        this.name = 'ForbiddenError'
    }
}

/** Thrown when a referenced resource doesn't exist (e.g. an unknown Snapshots snapshot name). Route
 *  glue turns this into a 404, distinct from ForbiddenError's 403 (bad input vs. missing thing). */
export class NotFoundError extends Error {
    constructor(message = 'not found') {
        super(message)
        this.name = 'NotFoundError'
    }
}

/** Thrown when a precondition the caller supplied no longer holds: a storage `copy` whose `ifMatch` names a
 *  version of the source that has since changed. The caller read something, decided, and the thing moved, so
 *  it should read again rather than retry. No route glue maps it (`withPortErrors` rethrows it, so
 *  it becomes a 500): a route that passes `ifMatch` catches it and answers a 409 or a 412. */
export class PreconditionFailedError extends Error {
    constructor(message = 'precondition failed') {
        super(message)
        this.name = 'PreconditionFailedError'
    }
}

/** Thrown by real adapters when their cutover items are unfilled (fail-fast for dev:real). */
export class CutoverPendingError extends Error {
    constructor(
        readonly cutoverItems: string[],
        detail: string,
    ) {
        super(`real adapters unavailable — open cutover items: ${cutoverItems.join(', ')}. ${detail}`)
        this.name = 'CutoverPendingError'
    }
}
