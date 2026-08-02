/**
 * FIXTURE ROUTE — SCANNED, NEVER SERVED. See ../../dockets/route.ts for what this tree is.
 *
 * THIS FILE keeps the `simulator/` PREFIX exemption alive: a simulated-world surface is 404 in real
 * builds and is never a product mutation path. The gate the exemption rests on is the
 * `if (!isSimulated)` early return, and the scan checks this file actually contains it — the whole
 * point of the `mustMatch` mechanism is that a simulator route which lost its gate would otherwise be
 * silently exempt from authorize(...) AND ship live.
 *
 * `isSimulated` is a local stand-in, annotated `boolean` so the branch is not narrowed away: the real
 * one comes from keel/adapters, which pulls the whole adapter registry and `server-only`.
 */
const isSimulated: boolean = true

export async function POST(): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return Response.json({ ok: true })
}
