import { isSimulated } from '../../stand-ins'

/**
 * FIXTURE ROUTE — SCANNED, NEVER SERVED. See ../../dockets/route.ts for what this tree is.
 *
 * THIS FILE keeps the `simulator/` PREFIX exemption alive: a simulated-world surface is 404 in real
 * builds and is never a product mutation path. The gate the exemption rests on is the
 * `if (!isSimulated)` early return, and the scan checks that each mutating handler here opens with it,
 * with an imported `isSimulated` and a branch that does nothing but return the 404 — the whole point of
 * the `mustMatch` mechanism is that a simulator route which lost its gate would otherwise be silently
 * exempt from authorize(...) AND ship live.
 *
 * `isSimulated` is imported from ../../stand-ins.ts, for the reason given there.
 */
export async function POST(): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return Response.json({ ok: true })
}
