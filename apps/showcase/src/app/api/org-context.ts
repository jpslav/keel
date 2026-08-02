import { db } from 'keel/adapters/index'
import { orgIdForSlug } from 'keel/db/org-lookup'
import { tenantIdForSlug } from 'keel/db/tenant-lookup'
import type { AuthUser } from 'keel/ports/auth'

/**
 * The session's active tenant + org uuids — the resolution every product route used to repeat inline
 * before it could audit or query, kept in ONE place so the 404 contract ('unknown tenant' /
 * 'unknown org') cannot drift between routes. Callers return the Response verbatim when resolution
 * fails:
 *
 *     const resolved = await resolveOrgContext(user)
 *     if (resolved instanceof Response) return resolved
 *     const { tenantId, orgId } = resolved
 */
export async function resolveOrgContext(user: AuthUser): Promise<{ tenantId: string; orgId: string } | Response> {
    const tenantId = await tenantIdForSlug(db, user.tenantSlug)
    if (!tenantId) return Response.json({ error: 'unknown tenant' }, { status: 404 })
    const orgId = await orgIdForSlug(db, tenantId, user.orgSlug)
    if (!orgId) return Response.json({ error: 'unknown org' }, { status: 404 })
    return { tenantId, orgId }
}

/** Tenant-only variant for recipient-scoped routes (the notifications pair) that never need the org. */
export async function resolveTenantId(user: AuthUser): Promise<string | Response> {
    const tenantId = await tenantIdForSlug(db, user.tenantSlug)
    if (!tenantId) return Response.json({ error: 'unknown tenant' }, { status: 404 })
    return tenantId
}
