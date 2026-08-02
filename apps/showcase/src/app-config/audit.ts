/**
 * The APP's audit-action vocabulary (the seam side of packages/keel/src/db/audit.ts, ADR-0012). The framework's
 * recordAuditEvent takes AuditAction = FrameworkAuditAction | AppAuditAction (a type-only seam import),
 * so a route can only record a verb the vocabulary names. A real adopter replaces these with its own
 * verbs; the mechanism (one append-only tenant-scoped INSERT) is unchanged.
 */
export type AppAuditAction =
    | 'ticket.created'
    | 'ticket.updated'
    | 'ticket.assigned'
    | 'ticket.deleted'
    | 'attachment.minted'
    | 'attachment.confirmed'
    | 'escalation.created'
    | 'escalation.accepted'
    | 'escalation.rejected'
    | 'escalation.cancelled'
