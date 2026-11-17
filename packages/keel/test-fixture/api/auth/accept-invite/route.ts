import { acceptInvite } from '../../stand-ins'

/**
 * FIXTURE ROUTE — SCANNED, NEVER SERVED. See ../../dockets/route.ts for what this tree is.
 *
 * THIS FILE backs the `auth/accept-invite/route.ts` EXACT exemption: acceptance is authorized by
 * possession of the invite token, which is the only credential that can exist before any membership
 * does. The gate is `acceptInvite(` — the token-redeeming call. A route under this path that did
 * anything else (adding a membership directly, say) would not contain it and would have to authorize.
 *
 * `acceptInvite` is imported from ../../stand-ins.ts, for the reason given there.
 */
export async function POST(): Promise<Response> {
    const joined = await acceptInvite('fixture-invite')
    return Response.json({ ok: true, id: joined.id })
}
