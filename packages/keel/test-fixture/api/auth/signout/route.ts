import type { AuthPort } from 'keel/ports/auth'

/**
 * FIXTURE ROUTE — SCANNED, NEVER SERVED. See ../../dockets/route.ts for what this tree is.
 *
 * THIS FILE backs the `auth/signout/route.ts` EXACT exemption: session lifecycle, no product resource,
 * and it runs post-authorization by definition. The gate is `auth.signOut(` — the whole route is that
 * one port call, so anything else under this path is not the route the exemption describes.
 *
 * Local stand-in typed against the port, for the reason given in ../../profile/route.ts.
 */
const auth: Pick<AuthPort, 'signOut'> = { signOut: async () => {} }

export async function POST(): Promise<Response> {
    await auth.signOut()
    return Response.json({ ok: true })
}
