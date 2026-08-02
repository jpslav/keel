/**
 * FIXTURE ROUTE — SCANNED, NEVER SERVED. See ../../dockets/route.ts for what this tree is.
 *
 * THIS FILE backs the `auth/accept-invite/route.ts` EXACT exemption: acceptance is authorized by
 * possession of the invite token, which is the only credential that can exist before any membership
 * does. The gate is `acceptInvite(` — the token-redeeming call. A route under this path that did
 * anything else (adding a membership directly, say) would not contain it and would have to authorize.
 *
 * `acceptInvite` is a local stand-in and NOT typed against a port, because it is not on one: redeeming
 * an invite token is the fake auth adapter's own entry point (keel/adapters/fake/auth), which real
 * mode replaces with the provider's hosted ticket flow. Same stand-in convention as
 * ../../service/jobs/route.ts.
 */
const acceptInvite = async (inviteId: string): Promise<{ id: string }> => ({ id: inviteId })

export async function POST(): Promise<Response> {
    const joined = await acceptInvite('fixture-invite')
    return Response.json({ ok: true, id: joined.id })
}
