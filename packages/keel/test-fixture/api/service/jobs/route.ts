/**
 * FIXTURE ROUTE — SCANNED, NEVER SERVED. See ../../dockets/route.ts for what this tree is.
 *
 * THIS FILE keeps the `service/` PREFIX exemption alive: service callers are org-scoped by
 * construction (the verifying key row IS an org), so the gate the exemption rests on is
 * `withServiceCaller`, and the scan checks that this file actually contains it.
 *
 * The wrapper is a local stand-in rather than an import: `withServiceCaller` is app-side machinery
 * (each app composes it over its own respond helpers), so there is no framework symbol to reach for.
 */
const withServiceCaller = (handler: () => Promise<Response>): Promise<Response> => handler()

export async function POST(): Promise<Response> {
    return withServiceCaller(async () => Response.json({ ok: true }))
}
