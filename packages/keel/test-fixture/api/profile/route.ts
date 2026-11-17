import { auth } from '../stand-ins'

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
 * `auth` is imported from ../stand-ins.ts, typed `Pick<AuthPort, …>` there on purpose: a port rename then
 * breaks the build instead of silently leaving the exemption's `mustMatch` pointed at a call that no longer
 * exists.
 */
export async function PUT(): Promise<Response> {
    const user = await auth.updateProfile({ name: 'Ada Keeper' })
    return Response.json({ user })
}
