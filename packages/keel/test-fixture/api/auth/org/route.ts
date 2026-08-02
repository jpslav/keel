import type { AuthPort } from 'keel/ports/auth'

/**
 * FIXTURE ROUTE — SCANNED, NEVER SERVED. See ../../dockets/route.ts for what this tree is.
 *
 * THIS FILE backs the `auth/org/route.ts` EXACT exemption: setActiveOrg enforces membership at the
 * auth port itself (ForbiddenError for non-members), so the check is the port's, not the route's. The
 * gate is therefore `auth.setActiveOrg(` — the exemption's reason names that call, so the scan
 * requires it. A same-named route that switched org some other way would have to authorize.
 *
 * Local stand-in typed against the port, for the reason given in ../../profile/route.ts.
 */
const auth: Pick<AuthPort, 'setActiveOrg'> = { setActiveOrg: async () => {} }

export async function POST(): Promise<Response> {
    await auth.setActiveOrg('depot')
    return Response.json({ ok: true })
}
