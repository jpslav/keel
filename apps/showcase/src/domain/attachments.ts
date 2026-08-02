/**
 * Typed attachments. PURE TypeScript — no framework imports (ADR-0006, lint-enforced): the kind enum,
 * the size ceiling, and the filename/size helpers are shared verbatim by the server routes, the storage
 * adapters, and the static demo twin, so "what is a legal attachment" can never drift between them. An
 * attachment is a browser-uploaded file, org-scoped, modelled as one typed table row.
 */

/**
 * App-defined attachment kinds. TWO of them, because a kind registry with one member proves nothing
 * about composition:
 * - `attachment` — the ordinary case: a screenshot, an invoice, whatever the customer sent.
 * - `diagnostic-bundle` — a log bundle a partner analyzer can be asked to look at. Same table, same
 *   ability rule, same upload path; what differs is that only this kind is offered to the
 *   `analyze-bundle` job, which is exactly the sort of per-kind branch a real product grows.
 *
 * The column is `text`, so the DB accepts any string; this list is the source of truth the mint route
 * validates against, exactly like isJobKind guards the jobs table. Adding a third kind is a one-line
 * change here plus its label in the app catalog (there is no per-kind ability — all kinds share the
 * Attachment rule).
 */
export const ATTACHMENT_KINDS = ['attachment', 'diagnostic-bundle'] as const
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]

export function isAttachmentKind(value: string): value is AttachmentKind {
    return (ATTACHMENT_KINDS as readonly string[]).includes(value)
}

/** The one kind the bundle analyzer will accept — see src/jobs/analyze-bundle.ts. */
export const ANALYZABLE_KIND: AttachmentKind = 'diagnostic-bundle'

/**
 * Upload ceiling enforced on BOTH sides of the presigned POST: it becomes the S3
 * content-length-range condition (real adapter) / the fake endpoint's size check, AND the mint route
 * fails fast when a client declares a larger size. 5 MiB is a deliberately small scaffold default —
 * an app raises it consciously (and revisits the Lambda/CloudFront body limits on cutover).
 */
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024

/**
 * Reduce a user-supplied filename to a safe last path segment: strip any directory portion, collapse
 * anything outside [A-Za-z0-9._-] to '_', drop leading dots (no dotfiles / no '..'), cap length. The
 * result is only ever the LAST segment of a server-built storage key (`attachments/<tenant>/<uuid>/<name>`),
 * so it can never introduce a path escape — but sanitizing keeps stored keys tidy and predictable.
 */
export function sanitizeFilename(name: string): string {
    const base = name.split(/[\\/]/).pop() ?? ''
    const cleaned = base
        .replace(/[^A-Za-z0-9._-]+/g, '_')
        .replace(/^\.+/, '')
        .slice(0, 128)
    return cleaned || 'file'
}

/**
 * Human-readable byte size. Returns bare number + a locale-neutral SI-style unit symbol (B/KB/MB) —
 * NOT translatable prose, so it lives in pure core and is rendered through a JSX expression container
 * (dodging react/jsx-no-literals without a message key, and dodging ICU number formatting the way the
 * slice brief asks). '—' for an unknown size (a pending row before confirm records the real length).
 */
export function formatBytes(bytes: number | null | undefined): string {
    if (bytes == null) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
