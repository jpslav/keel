/**
 * The APP's audit-action vocabulary (the seam side of keel/db/audit.ts, ADR-0012).
 *
 * `docket.created` because the fixture's inbound-email handler records it: `inbound-email/intake.test.ts`
 * asserts the intake event lands beside the handler's own domain verb, which is only meaningful if the
 * app half of the union is non-empty. `docket.flagged` because the fixture's preset operation kind
 * (app-config/presets/operations/docket-flag) records it: an app kind's server half audits what it
 * changes, like any product write.
 */
export type AppAuditAction = 'docket.created' | 'docket.flagged'
