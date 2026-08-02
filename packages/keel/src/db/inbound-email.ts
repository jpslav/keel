import type { DbPort } from '../ports/db'

/**
 * DB access for inbound email: the row writes intake performs (insert 'received', update the
 * final status) all go through withTenant, and the global org resolution + the Simulator world list are
 * raw reads of the RLS-free infra tables (the org-lookup / listSchedulesForWorld precedents).
 */

/** timestamptz reads back a Date on real pg, a string on pglite — normalise (the webhooks.ts iso). */
function iso(value: unknown): string {
    return value instanceof Date ? value.toISOString() : String(value)
}

export interface ResolvedInboundOrg {
    tenantId: string
    tenantSlug: string
    orgId: string
    orgSlug: string
}

/**
 * Resolve an org slug to its (tenant, org) GLOBALLY — the recipient address (`<org-slug>+<handler>@…`)
 * names only the org, not the tenant. Org slugs are unique across the seed, so a single match yields the
 * tenant too. ZERO matches (unknown slug) OR more than one (the same slug reused in two tenants — the
 * schema permits it, though the seed never does) both return null: an address alone can't disambiguate
 * a collision, so it's treated as unresolved rather than filed under an arbitrary tenant. A real
 * MULTI-domain instance resolves the tenant from the recipient DOMAIN first (see the decision log).
 * Reads the RLS-free `organizations`/`tenants` infra tables — the orgIdForSlug precedent.
 */
export async function resolveOrgBySlugGlobally(db: DbPort, orgSlug: string): Promise<ResolvedInboundOrg | null> {
    await db.ready()
    const rows = await db
        .getDb()
        .selectFrom('organizations')
        .innerJoin('tenants', 'tenants.id', 'organizations.tenant_id')
        .select([
            'organizations.id as org_id',
            'organizations.slug as org_slug',
            'organizations.tenant_id as tenant_id',
            'tenants.slug as tenant_slug',
        ])
        .where('organizations.slug', '=', orgSlug)
        .execute()
    if (rows.length !== 1) return null
    const row = rows[0]!
    return { tenantId: row.tenant_id, tenantSlug: row.tenant_slug, orgId: row.org_id, orgSlug: row.org_slug }
}

export interface InsertInboundInput {
    tenantId: string
    orgId: string | null
    fromEmail: string
    toEmail: string
    subject: string
    bodyText: string
    bodyHtml: string | null
}

/** File a new inbound message as 'received' (tenant-scoped INSERT under RLS). Returns its id. */
export async function insertInboundEmail(db: DbPort, input: InsertInboundInput): Promise<{ id: string }> {
    return db.withTenant(input.tenantId, (trx) =>
        trx
            .insertInto('inbound_emails')
            .values({
                tenant_id: input.tenantId,
                org_id: input.orgId,
                from_email: input.fromEmail,
                to_email: input.toEmail,
                subject: input.subject,
                body_text: input.bodyText,
                body_html: input.bodyHtml,
            })
            .returning('id')
            .executeTakeFirstOrThrow(),
    )
}

/** Record an inbound message's final intake outcome (the granted in-place UPDATE under RLS). */
export async function setInboundStatus(
    db: DbPort,
    tenantId: string,
    id: string,
    update: { status: 'handled' | 'unmatched' | 'failed'; handler: string | null; error: string | null },
): Promise<void> {
    await db.withTenant(tenantId, (trx) =>
        trx
            .updateTable('inbound_emails')
            .set({ status: update.status, handler: update.handler, error: update.error })
            .where('id', '=', id)
            .execute(),
    )
}

export interface WorldInboundEmail {
    id: string
    toEmail: string
    fromEmail: string
    subject: string
    status: string
    handler: string | null
    error: string | null
    createdAt: string
    tenantSlug: string
    orgSlug: string | null
}

/**
 * Every inbound message across ALL tenants, newest-first — the Simulator Mail-tab inbound view. A raw
 * cross-tenant read (the listDeliveriesForWorld precedent), reaching past the tenant RLS scope on
 * purpose; the route gates it to simulated mode. Left-joins organizations so an org-less row still lists.
 */
export async function listInboundForWorld(db: DbPort): Promise<WorldInboundEmail[]> {
    await db.ready()
    const rows = await db
        .getDb()
        .selectFrom('inbound_emails as i')
        .innerJoin('tenants', 'tenants.id', 'i.tenant_id')
        .leftJoin('organizations', 'organizations.id', 'i.org_id')
        .select([
            'i.id as id',
            'i.to_email as to_email',
            'i.from_email as from_email',
            'i.subject as subject',
            'i.status as status',
            'i.handler as handler',
            'i.error as error',
            'i.created_at as created_at',
            'tenants.slug as tenant_slug',
            'organizations.slug as org_slug',
        ])
        .orderBy('i.created_at', 'desc')
        .execute()
    return rows.map((r) => ({
        id: r.id,
        toEmail: r.to_email,
        fromEmail: r.from_email,
        subject: r.subject,
        status: r.status,
        handler: r.handler,
        error: r.error,
        createdAt: iso(r.created_at),
        tenantSlug: r.tenant_slug,
        orgSlug: r.org_slug ?? null,
    }))
}
