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
