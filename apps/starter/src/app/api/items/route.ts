import { auth, db } from 'keel/adapters/index'
import { authorize } from 'keel/authz/authorize'
import { orgIdForSlug } from 'keel/db/org-lookup'
import { tenantIdForSlug } from 'keel/db/tenant-lookup'
import { withPortErrors } from '../respond'

/**
 * The app's only product route. Items are tenant-scoped by RLS (the hostile-isolation boundary) AND
 * filtered to the active org (the team boundary — an app-level WHERE, since org membership is enforced
 * at the auth port; ADR-0004). Every query runs inside withTenant.
 */
export async function GET(): Promise<Response> {
    return withPortErrors(async () => {
        const user = await auth.requireUser()
        const tenantId = await tenantIdForSlug(db, user.tenantSlug)
        if (!tenantId) return Response.json({ error: 'unknown tenant' }, { status: 404 })
        const orgId = await orgIdForSlug(db, tenantId, user.orgSlug)
        if (!orgId) return Response.json({ error: 'unknown org' }, { status: 404 })
        const items = await db.withTenant(tenantId, (trx) =>
            trx
                .selectFrom('items')
                .select(['id', 'title'])
                .where('org_id', '=', orgId)
                .orderBy('created_at', 'desc')
                .execute(),
        )
        return Response.json({ items })
    })
}

export async function POST(request: Request): Promise<Response> {
    return withPortErrors(async () => {
        const user = await auth.requireUser()
        const { title } = (await request.json()) as { title: string }
        if (!title?.trim()) return Response.json({ error: 'empty item' }, { status: 400 })
        const tenantId = await tenantIdForSlug(db, user.tenantSlug)
        if (!tenantId) return Response.json({ error: 'unknown tenant' }, { status: 404 })
        const orgId = await orgIdForSlug(db, tenantId, user.orgSlug)
        if (!orgId) return Response.json({ error: 'unknown org' }, { status: 404 })
        // The authorization choke point: restricted members may read items but not author them.
        // Throws ForbiddenError → 403 via withPortErrors.
        authorize(user, orgId, 'create', { type: 'Item', orgId })
        const item = await db.withTenant(tenantId, (trx) =>
            trx
                .insertInto('items')
                .values({ tenant_id: tenantId, org_id: orgId, title: title.trim(), created_by_user_id: user.id })
                .returning(['id', 'title'])
                .executeTakeFirstOrThrow(),
        )
        return Response.json({ item })
    })
}
