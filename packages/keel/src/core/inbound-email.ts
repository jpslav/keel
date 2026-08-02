/**
 * Inbound email address scheme + normalization — PURE, ISOMORPHIC TypeScript (ADR-0006,
 * lint-enforced): no framework, no node builtins. The SAME parser runs on the server intake AND inside
 * the file:// static-demo twin, so an inbound-email demo works with no server at all.
 *
 * ## Address scheme — plus (sub-addressing) convention: `<org-slug>+<handler>@<domain>`
 *
 * e.g. `sales+support@mg.example.com`. The base local part is the ORG slug, the `+tag` is the HANDLER
 * slug. Chosen over the subdomain form (`support@sales.example.com`) because it needs a SINGLE Mailgun
 * domain and a SINGLE catch-all route — no per-org DNS/MX. The plus sign is RFC-5321-valid in a local
 * part and Mailgun routes match it with a regex (`match_recipient(".*\\+.*@domain")`); the classic
 * client-side worry that a mail client strips `+tag` only bites addresses a HUMAN types as their own
 * From/To — this is an intake address the app HANDS OUT for the world to send to, so stripping never
 * applies. See the decision log.
 *
 * ## Org resolution
 *
 * The address names only the org slug (no tenant). Org slugs are unique per tenant in the schema, so a
 * caller resolves the org GLOBALLY by slug (unique across the seed) which yields the tenant too; an
 * ambiguous slug across tenants can't be disambiguated from the address alone and is treated as
 * unresolved. A real MULTI-domain instance maps the recipient DOMAIN to the tenant first — documented
 * as the single-domain simplification in the decision log. This module owns only the pure PARSE; the
 * DB resolution lives in packages/keel/src/inbound-email/intake.ts.
 */

/**
 * The fake-world display domain the Simulator "compose inbound" flow and the static twin build intake
 * addresses under (`sales+support@inbound.example.test`). It is a SIMULATED-WORLD value, not a
 * deployment parameter — the real inbound domain is Mailgun's (`config/params.ts` mailgun.domain), and
 * the real webhook only ever PARSES the domain a message arrives on, never constructs one. Matches the
 * seed's `@example.test` person convention.
 */
export const DEMO_INBOUND_DOMAIN = 'inbound.example.test'

/** A parsed recipient: which org's which handler the message is addressed to. */
export interface InboundRecipient {
    orgSlug: string
    handler: string
}

/** Slug shape shared by org slugs and handler slugs: lowercase alnum, internal hyphens. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Pull the bare addr-spec out of a possibly-decorated address: `"Ada Keeper" <ada@x.test>` → `ada@x.test`,
 * a bare `ada@x.test` → itself. Lowercased and trimmed (email domains are case-insensitive, and local
 * parts are case-insensitive in every practical mail system — we normalize so a sender/member match is
 * not defeated by case). Returns '' for anything without an addr-spec.
 */
export function normalizeEmailAddress(raw: string): string {
    const angle = raw.match(/<([^>]+)>/)
    const candidate = (angle ? angle[1]! : raw).trim().toLowerCase()
    // A single '@' with non-empty both sides, else not a usable address.
    const at = candidate.indexOf('@')
    if (at <= 0 || at !== candidate.lastIndexOf('@') || at === candidate.length - 1) return ''
    return candidate
}

/**
 * Parse a recipient address into `{ orgSlug, handler }`, or null when it doesn't fit the scheme. The
 * local part must be `<org-slug>+<handler>`; both halves must be non-empty slugs. Everything is
 * lowercased first (see normalizeEmailAddress). A recipient with no `+`, an empty half, or a
 * non-slug half returns null (→ the message is filed 'unmatched' with no handler).
 */
export function parseInboundRecipient(rawRecipient: string): InboundRecipient | null {
    const address = normalizeEmailAddress(rawRecipient)
    if (!address) return null
    const localPart = address.slice(0, address.indexOf('@'))
    const plus = localPart.indexOf('+')
    if (plus <= 0 || plus === localPart.length - 1) return null
    const orgSlug = localPart.slice(0, plus)
    const handler = localPart.slice(plus + 1)
    if (!SLUG.test(orgSlug) || !SLUG.test(handler)) return null
    return { orgSlug, handler }
}

/** Build the intake address for an org+handler under a domain — the inverse of parseInboundRecipient. */
export function formatInboundRecipient(orgSlug: string, handler: string, domain: string): string {
    return `${orgSlug}+${handler}@${domain}`
}

// Reply-chain boundaries we recognize. Deliberately conservative (see normalizeInboundBody): only the
// top-posted reply above one of these markers is kept.
const REPLY_MARKERS: RegExp[] = [
    // Gmail / Apple Mail: "On Tue, Jul 22, 2026 at 3:04 PM Ada Keeper <ada@x> wrote:"
    /^\s*On .+ wrote:\s*$/m,
    // Outlook / many clients: "-----Original Message-----"
    /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
    // Outlook header block: "From: someone" at the start of a line
    /^\s*From:\s.+$/m,
]

/**
 * Normalize an inbound body to plain text, stripping the quoted reply chain MINIMALLY and HONESTLY:
 * keep everything up to the FIRST recognized reply marker (see REPLY_MARKERS), trimmed. This keeps the
 * top-posted new message and drops the quoted history — the common case — without pretending to a full
 * MIME/quote parser. Its limits, recorded on purpose: bottom-posting and interleaved inline quoting are
 * NOT handled (the whole body is kept if no marker appears), and a body that is ENTIRELY quoted would
 * trim to empty — so if stripping would leave nothing, the original trimmed text is kept instead. In
 * real mode Mailgun's own `stripped-text` is preferred upstream; this is the fallback and the twin's
 * only stripper.
 */
export function normalizeInboundBody(raw: string): string {
    const text = (raw ?? '').replace(/\r\n/g, '\n')
    let cut = text.length
    for (const marker of REPLY_MARKERS) {
        const match = marker.exec(text)
        if (match && match.index < cut) cut = match.index
    }
    const stripped = text.slice(0, cut).trim()
    return stripped.length > 0 ? stripped : text.trim()
}
