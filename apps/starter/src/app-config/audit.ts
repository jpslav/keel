/**
 * The APP's audit-action vocabulary (the seam side of keel/db/audit.ts, ADR-0012).
 *
 * EMPTY REGISTRATION. This app records no audit verbs of its own, so the union it contributes is
 * `never` and `AuditAction` collapses to the framework's own verbs. The audit trail still works —
 * framework mutations (invites, agreement acceptances, webhook lifecycle) record as they always did.
 * Adding a verb is one union member here plus the `recordAuditEvent` call at the mutation site.
 */
export type AppAuditAction = never
