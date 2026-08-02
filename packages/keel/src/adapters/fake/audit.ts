import { toIso } from '../../db/jobs'
import { fakeDb } from './db'

/** One row of the simulated-mode cross-tenant audit god view (NOT part of any port). */
export interface WorldAuditEvent {
    id: string
    action: string
    subjectType: string
    subjectId: string | null
    actorUserId: string
    tenantSlug: string
    orgSlug: string
    at: string
}

/**
 * Every audit event across ALL tenants, joined to tenant/org slugs, newest first (cap 100) — the
 * Simulator Events tab's read-only "product record" section. A raw getDb() read on purpose: this is
 * the simulated-world god view, deliberately reaching past the tenant RLS scope (simulated-mode-only), the
 * exact same justification as listWorldJobs, beside which this lives conceptually. org_id is NOT NULL
 * on audit_events, so the organizations join is inner (every event has an org).
 */
export async function listWorldAuditEvents(): Promise<WorldAuditEvent[]> {
    await fakeDb.ready()
    const rows = await fakeDb
        .getDb()
        .selectFrom('audit_events')
        .innerJoin('tenants', 'tenants.id', 'audit_events.tenant_id')
        .innerJoin('organizations', 'organizations.id', 'audit_events.org_id')
        .select([
            'audit_events.id as id',
            'audit_events.action as action',
            'audit_events.subject_type as subject_type',
            'audit_events.subject_id as subject_id',
            'audit_events.actor_user_id as actor_user_id',
            'audit_events.at as at',
            'tenants.slug as tenant_slug',
            'organizations.slug as org_slug',
        ])
        .orderBy('audit_events.at', 'desc')
        .limit(100)
        .execute()
    return rows.map((r) => ({
        id: r.id,
        action: r.action,
        subjectType: r.subject_type,
        subjectId: r.subject_id,
        actorUserId: r.actor_user_id,
        tenantSlug: r.tenant_slug,
        orgSlug: r.org_slug,
        at: toIso(r.at),
    }))
}
