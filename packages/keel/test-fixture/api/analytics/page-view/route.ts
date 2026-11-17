import { analytics } from '../../stand-ins'

/**
 * FIXTURE ROUTE — SCANNED, NEVER SERVED. See ../../dockets/route.ts for what this tree is.
 *
 * THIS FILE backs the `analytics/page-view/route.ts` EXACT exemption: a telemetry beacon records a
 * page view and mutates no product resource. The gate is `analytics.capture(` — the beacon speaks to
 * the analytics port, which is the checkable half of "mutates no product resource"; a same-named route
 * that wrote product rows instead would not contain it.
 *
 * `analytics` is imported from ../../stand-ins.ts, for the reason given there.
 */
export async function POST(): Promise<Response> {
    await analytics.capture('page_view', { path: '/fixture' })
    return new Response(null, { status: 204 })
}
