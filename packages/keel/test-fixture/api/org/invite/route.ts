import { authorize } from 'keel/authz/authorize'
import type { AuthUser } from 'keel/ports/auth'

/**
 * FIXTURE ROUTE — SCANNED, NEVER SERVED. See ../../dockets/route.ts for what this tree is.
 *
 * THIS FILE covers a FRAMEWORK capability every app inherits (inviting someone to a team): the subject
 * is a Membership, so the authorization is a real cross-actor check rather than a self-service one.
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
    authorize(CALLER, 'depot', 'create', { type: 'Membership', orgId: 'depot' })
    return Response.json({ ok: true })
}
