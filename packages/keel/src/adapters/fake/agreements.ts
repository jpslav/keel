import { bumpAgreementVersion } from '../../db/agreements'
import { fakeDb } from './db'

/**
 * Simulated-mode Simulator god operations for agreements — the Snapshots tab's Agreements section.
 * Reads are a raw cross-tenant getDb() view (the listWorldJobs / listWorldAuditEvents precedent,
 * deliberately reaching past the tenant RLS scope, simulated-mode-only); the bump reuses the real
 * tenant-scoped db module (withTenant → app_user UPDATE), so the demo drives the SAME write path a
 * real admin agreements UI would. Neither is part of any port.
 */

/** One row of the simulated-mode cross-tenant agreements god view. */
export interface WorldAgreement {
    id: string
    tenantSlug: string
    kind: string
    title: string
    version: number
    gating: string
    /** How many acceptances exist at the CURRENT version (i.e. who is up to date). */
    currentAcceptances: number
    /** Total acceptance rows ever recorded for this agreement (across versions). */
    totalAcceptances: number
}

/** Every agreement across ALL tenants with acceptance tallies, for the Snapshots Agreements section. */
export async function listWorldAgreements(): Promise<WorldAgreement[]> {
    await fakeDb.ready()
    const db = fakeDb.getDb()
    const agreements = await db
        .selectFrom('agreements')
        .innerJoin('tenants', 'tenants.id', 'agreements.tenant_id')
        .select([
            'agreements.id as id',
            'agreements.kind as kind',
            'agreements.title as title',
            'agreements.version as version',
            'agreements.gating as gating',
            'tenants.slug as tenant_slug',
        ])
        .orderBy('tenants.slug', 'asc')
        .orderBy('agreements.created_at', 'asc')
        .execute()

    const acceptances = await db
        .selectFrom('agreement_acceptances')
        .select(['agreement_id', 'agreement_version'])
        .execute()

    return agreements.map((a) => {
        const version = Number(a.version)
        const rows = acceptances.filter((x) => x.agreement_id === a.id)
        return {
            id: a.id,
            tenantSlug: a.tenant_slug,
            kind: a.kind,
            title: a.title,
            version,
            gating: a.gating,
            currentAcceptances: rows.filter((x) => Number(x.agreement_version) >= version).length,
            totalAcceptances: rows.length,
        }
    })
}

/**
 * Bump one agreement's version (the demo story). Resolves the agreement's tenant with a raw god read,
 * then delegates to the real tenant-scoped db bump. Returns the new version, or null when the id is
 * unknown.
 */
export async function bumpWorldAgreement(agreementId: string): Promise<{ version: number } | null> {
    await fakeDb.ready()
    const row = await fakeDb
        .getDb()
        .selectFrom('agreements')
        .select('tenant_id')
        .where('id', '=', agreementId)
        .executeTakeFirst()
    if (!row) return null
    return bumpAgreementVersion(fakeDb, row.tenant_id, agreementId, new Date())
}
