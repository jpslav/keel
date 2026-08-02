import { authorize } from 'keel/authz/authorize'
import type { AuthUser } from 'keel/ports/auth'

/**
 * FIXTURE ROUTE — SCANNED, NEVER SERVED.
 *
 * `packages/keel/test-fixture/api/` is a route tree that exists only to be READ by
 * keel/authz/authorized-mutations.test.ts's bypass-catcher scan. It sits outside every app's
 * `src/app`, so Next.js never routes to it and nothing here is reachable at runtime. Each file is the
 * thinnest thing that still carries the property the scan asserts about its class of route.
 *
 * THIS FILE is the scan's non-vacuity anchor: a mutating route that is NOT exempt and therefore has to
 * call `authorize(...)` for real. Without one, every per-file assertion could be satisfied by the
 * exemption branch and the whole suite would prove nothing.
 */
const CALLER: AuthUser = {
    id: 'fixture-lead',
    name: 'Ada Keeper',
    email: 'ada.keeper@example.test',
    role: 'admin',
    locale: 'en',
    tenantSlug: 'harbor',
    orgSlug: 'depot',
    restricted: false,
}

export async function POST(): Promise<Response> {
    authorize(CALLER, 'depot', 'create', { type: 'Docket', orgId: 'depot' })
    return Response.json({ ok: true })
}
