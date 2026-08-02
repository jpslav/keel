/**
 * The APP's audit-action vocabulary (the seam side of keel/db/audit.ts, ADR-0012).
 *
 * ONE verb, because the fixture's inbound-email handler records one: `inbound-email/intake.test.ts`
 * asserts the intake event lands beside the handler's own domain verb, which is only meaningful if the
 * app half of the union is non-empty.
 */
export type AppAuditAction = 'docket.created'
