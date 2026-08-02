import type { AuthPort } from 'keel/ports/auth'

/**
 * FIXTURE ROUTE — SCANNED, NEVER SERVED. See ../dockets/route.ts for what this tree is.
 *
 * THIS FILE backs the `profile/route.ts` EXACT exemption: self-service, where the subject IS the
 * caller (User.update is self-only), so there is no cross-actor authorization to perform. The gate the
 * exemption rests on is `auth.updateProfile(`, and that gate is what makes the claim CHECKABLE rather
 * than merely asserted: `updateProfile` takes no user id, so it can only ever write the session's own
 * user. A route that updates some OTHER user by id cannot be written through it, and therefore cannot
 * inherit this exemption just by being named `profile/route.ts`.
 *
 * `auth` is a local stand-in, the convention this tree uses for machinery it cannot import (see
 * ../service/jobs/route.ts): `keel/adapters` pulls the whole registry and `server-only`. It is typed
 * `Pick<AuthPort, …>` on purpose — a port rename then breaks the build here instead of silently
 * leaving the exemption's `mustMatch` pointed at a call that no longer exists.
 */
const auth: Pick<AuthPort, 'updateProfile'> = {
    updateProfile: async () => {
        throw new Error('fixture route — never served')
    },
}

export async function PUT(): Promise<Response> {
    const user = await auth.updateProfile({ name: 'Ada Keeper' })
    return Response.json({ user })
}
