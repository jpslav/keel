import { authorize } from 'keel/authz/authorize'
import type { AuthUser } from 'keel/ports/auth'

/**
 * FIXTURE ROUTE — SCANNED, NEVER SERVED. See ../route.ts for what this tree is.
 *
 * THIS FILE is the scan's PER-VERB anchor: one route file exporting two mutating handlers, each judged on
 * its own. The scan used to ask whether the FILE contained `authorize(`, so an authorized PATCH beside an
 * open DELETE passed. Here both verbs authorize, by the two routes the scan follows:
 *
 * - PATCH calls `authorize(...)` in its own body;
 * - DELETE calls `authorizeDocket`, a function in THIS file that calls `authorize(...)`. The scan follows a
 *   call into a same-module function; it does not follow one into another module.
 */
const STEWARD: AuthUser = {
    id: 'fixture-steward',
    name: 'Ines Steward',
    email: 'ines.steward@example.test',
    role: 'member',
    locale: 'es',
    tenantSlug: 'harbor',
    orgSlug: 'annex',
    restricted: false,
}

function authorizeDocket(action: 'update' | 'delete'): void {
    authorize(STEWARD, 'annex', action, { type: 'Docket', orgId: 'annex' })
}

export async function PATCH(): Promise<Response> {
    authorize(STEWARD, 'annex', 'update', { type: 'Docket', orgId: 'annex' })
    return Response.json({ ok: true })
}

export async function DELETE(): Promise<Response> {
    authorizeDocket('delete')
    return new Response(null, { status: 204 })
}
