import type { AppAuditAction } from '@app-config/audit'
import type { SubjectType } from '../core/abilities'
import type { DbPort } from '../ports/db'

/**
 * The FRAMEWORK's audit-action vocabulary. The app's own verbs register through the seam
 * (src/app-config/audit.ts AppAuditAction), composed into AuditAction below exactly like SubjectType
 * composes base + app (ADR-0012).
 */
type FrameworkAuditAction =
    | 'membership.invited'
    | 'job.submitted'
    | 'agreement.accepted'
    | 'schedule.fired'
    | 'webhook-endpoint.created'
    | 'webhook-endpoint.enabled'
    | 'webhook-endpoint.disabled'
    | 'webhook-endpoint.deleted'
    | 'webhook.delivered'
    | 'webhook.dead'
    | 'inbound-email.received'

/** The full audit-action union: framework verbs + the app's registered verbs. */
type AuditAction = FrameworkAuditAction | AppAuditAction

/**
 * The audit-trail write helper. ONE function, invoked on the mutation path — the natural
 * choke point is NOT authorize() (a pure, side-effect-free decision) but the line immediately after
 * a successfully-authorized write, where the action's real subject id is finally known. Each mutating
 * product route calls this after its write with an `action` from the AuditAction vocabulary (e.g.
 * `membership.invited`, or whichever verbs the app registered); it is a deliberate convention + helper,
 * not middleware magic, so the call is visible at every site (the same reasoning that made authorize()
 * an explicit per-handler call).
 *
 * One tenant-scoped INSERT through withTenant — RLS pins tenant_id, so an event can never be planted
 * into another tenant, and the table's SELECT/INSERT-only grant makes it append-only at the privilege
 * layer (a recorded event can never be rewritten or erased; proved in packages/keel/src/db/rls-proofs.ts).
 *
 * DELIBERATELY NON-ATOMIC with the mutation it records: this runs in its OWN transaction, strictly
 * after the mutation's commit. A rolled-back write therefore can never leave a phantom audit row
 * (the dangerous direction); the benign inverse — committed write, failed audit insert — surfaces as
 * a 500, never a silent gap. A shared transaction was rejected because some audited mutations (org
 * invites) happen on the auth port, not in the DB, so no single-txn shape covers all sites.
 *
 * SCOPE: only per-actor authorized product mutations are audited. Self-service (own profile),
 * session lifecycle (org switch, sign-in/out), and token-authorized flows (invite ACCEPTANCE — a
 * simulated-mode-only app route; real mode accepts via Clerk's client-side ticket flow that never hits
 * an app route, so auditing it here would record fake acceptances while real ones stay invisible)
 * are deliberately outside the trail. When a real-mode acceptance route exists, audit it there.
 */
export interface AuditEventInput {
    tenantId: string
    /** The active org the action happened in (NOT NULL in the table). */
    orgId: string
    /** The acting user's id (AuthUser.id). */
    actorUserId: string
    /** The audited verb — a framework verb (e.g. `membership.invited`) or one the app registered. */
    action: AuditAction
    /** The ability subject the action targeted. */
    subjectType: SubjectType
    /** The affected row's id — known by the time this is called (a create records AFTER the insert). */
    subjectId?: string | null
}

export async function recordAuditEvent(db: DbPort, input: AuditEventInput): Promise<void> {
    await db.withTenant(input.tenantId, (trx) =>
        trx
            .insertInto('audit_events')
            .values({
                tenant_id: input.tenantId,
                org_id: input.orgId,
                actor_user_id: input.actorUserId,
                action: input.action,
                subject_type: input.subjectType,
                subject_id: input.subjectId ?? null,
            })
            .execute(),
    )
}
