/**
 * FIXTURE ROUTE — SCANNED, NEVER SERVED. See ../../dockets/route.ts for what this tree is.
 *
 * THIS FILE backs the `auth/dev-signin/route.ts` EXACT exemption: session lifecycle again, but this
 * one is simulated-mode only, so its exemption carries a `mustMatch` for the `if (!isSimulated)` gate
 * and the scan checks the gate is really here.
 */
const isSimulated: boolean = true

export async function POST(): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return Response.json({ ok: true })
}
