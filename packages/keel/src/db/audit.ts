import type { AppAuditAction } from '@app-config/audit'
import { type Actor, type Credential, principalIdOf, type SubjectType } from '../core/abilities'
import type { DbPort } from '../ports/db'
import { jsonb } from './jsonb'

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
    /**
     * WHO acted: a person's user id (AuthUser.id), a machine's `<kind>:<id>`, or a `system:*` writer.
     * From an actor, spread {@link auditActorOf} instead of writing this and `credential` by hand.
     */
    actorUserId: string
    /**
     * HOW they proved it: the credential's kind and id, never a secret. Omitted, the row records NULL,
     * which reads as "not recorded" (every row before migration 0014, and writers that don't say).
     */
    credential?: Credential | null
    /** The audited verb — a framework verb (e.g. `membership.invited`) or one the app registered. */
    action: AuditAction
    /** The ability subject the action targeted. */
    subjectType: SubjectType
    /** The affected row's id — known by the time this is called (a create records AFTER the insert). */
    subjectId?: string | null
    /**
     * WHY it came out as it did, as a small JSON object: a refusal's code, how many rows a purge removed.
     * Omitted, the row records NULL. Never a secret, a token, a password or free-form personal data: the
     * trail is append-only, so nobody can redact what lands here. See {@link AuditDetail} for the rules
     * this call enforces before it writes.
     */
    detail?: AuditDetail | null
}

/** A value inside an {@link AuditDetail}: JSON, with no `undefined`, function, Date or class instance. */
export type AuditDetailValue =
    string | number | boolean | null | readonly AuditDetailValue[] | { readonly [key: string]: AuditDetailValue }

/**
 * An audit row's `detail` (migration 0016): codes and counts that say WHY, such as
 * `{ refusal: 'revoked' }` or `{ removed: 42 }`. The row's other columns already say who, what and when.
 *
 * `recordAuditEvent` checks it before it opens a transaction, and refuses it with an error that names
 * the rule and the path, never the value:
 *
 * - a plain object at the top, holding only strings, finite numbers, booleans, null, arrays and plain
 *   objects, nested at most {@link AUDIT_DETAIL_MAX_DEPTH} deep;
 * - at most {@link AUDIT_DETAIL_MAX_BYTES} bytes as JSON. A list that grows with your data does not
 *   belong here;
 * - no NUL character and no unpaired surrogate in any string (Postgres's jsonb refuses both);
 * - no key that NAMES a secret: its last word is `token`, `password`, `secret`, `cookie`, `apiKey` and
 *   the like (`tokenId` and `tokensRemoved` are fine);
 * - no string, key or value, shaped like an email address, a JWT or a `Bearer` credential.
 *
 * The last two are a backstop for the likely accident (spreading a request, a member or an error into
 * the detail), not a scrubber: a secret under an innocent key in an innocent shape passes. The rule is
 * the contract. Record a code or a count, never what a person typed, and never a credential.
 */
export type AuditDetail = { readonly [key: string]: AuditDetailValue }

/** The bound on an audit detail, in bytes of its JSON (UTF-8). Codes and counts take a few dozen. */
export const AUDIT_DETAIL_MAX_BYTES = 1024

/** How deep an audit detail may nest; the top object is level 1. Also what stops a cycle. */
const AUDIT_DETAIL_MAX_DEPTH = 4

/**
 * A key whose LAST word (or last two words, joined) is one of these names a secret. Words split on
 * camelCase and on anything not a letter or digit, lower-cased. A plural (`tokens`, `apiKeys`) names
 * secrets too, unless its value is a number, which counts them (`revokedTokens: 3`).
 */
const SECRET_KEY_WORDS = new Set([
    'password',
    'passwd',
    'pwd',
    'passphrase',
    'passcode',
    'secret',
    'token',
    'cookie',
    'authorization',
    'bearer',
    'jwt',
    'otp',
    'totp',
    'pin',
    'pem',
    'apikey',
    'accesskey',
    'privatekey',
    'secretkey',
    'signingkey',
    'sessionkey',
    'encryptionkey',
    'hmackey',
    'passwordhash',
    'cardnumber',
    'cvv',
    'cvc',
    'ssn',
])

// These run only on the serialized detail, which is bounded first, so no pattern ever sees more than
// AUDIT_DETAIL_MAX_BYTES (EMAIL_SHAPE's leading run backtracks, quadratically in a string's length).
const EMAIL_SHAPE = /[^\s@]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/u
const JWT_SHAPE = /eyJ[\w-]+\.[\w-]+\./
const BEARER_SHAPE = /\bbearer\s+[\w.~+/=-]{16,}/i
const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

function keyWords(key: string): string[] {
    return key
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
}

/**
 * Whether a key names a secret. `plural` for `tokens` or `revokedApiKeys`; `qualified` when a word comes
 * before the secret's own name (`revoked`), which is what makes a number under it read as a count.
 */
function secretNamed(key: string): { plural: boolean; qualified: boolean } | null {
    const words = keyWords(key)
    const last = words.at(-1)
    if (last === undefined) return null
    const before = words.length > 1 ? words.at(-2) : ''
    const own = (word: string): number => {
        if (SECRET_KEY_WORDS.has(`${before}${word}`) && before) return 2
        return SECRET_KEY_WORDS.has(word) ? 1 : 0
    }
    const singular = own(last)
    if (singular) return { plural: false, qualified: words.length > singular }
    if (last.length < 2 || !last.endsWith('s')) return null
    const plural = own(last.slice(0, -1))
    return plural ? { plural: true, qualified: words.length > plural } : null
}

/** What is wrong with a string, without repeating it. */
function stringProblem(value: string): string | null {
    if (value.includes('\u0000')) return 'holds a NUL character, which Postgres jsonb cannot store'
    if (UNPAIRED_SURROGATE.test(value)) return 'holds an unpaired surrogate, which Postgres jsonb cannot store'
    if (value.includes('@') && EMAIL_SHAPE.test(value)) return 'looks like an email address'
    if (value.includes('eyJ') && JWT_SHAPE.test(value)) return 'looks like a JWT'
    if (BEARER_SHAPE.test(value)) return 'looks like a Bearer credential'
    return null
}

function isPlainObject(value: object): boolean {
    const proto: unknown = Object.getPrototypeOf(value)
    return proto === Object.prototype || proto === null
}

function isTopLevelObject(value: unknown): value is object {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function refuse(path: string, problem: string): never {
    throw new Error(
        `keel: audit detail refused: ${path} ${problem}. An audit row can never be redacted, so record a ` +
            'code or a count, never a secret or personal data (keel/db/audit AuditDetail).',
    )
}

/**
 * One walk, run twice. `content: false` checks only that the value is JSON (types, depth, plain objects):
 * it runs on what the caller handed over, before anything bounds it. `content: true` adds every rule about
 * what a string or key says, and runs only on the serialized, bounded detail.
 */
function checkValue(value: unknown, path: string, depth: number, content: boolean): void {
    if (value === null || typeof value === 'boolean') return
    if (typeof value === 'string') {
        const problem = content ? stringProblem(value) : null
        if (problem) refuse(path, problem)
        return
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) refuse(path, 'is not a finite number')
        return
    }
    if (value === undefined) refuse(path, 'is undefined, which JSON writes as null in an array')
    if (typeof value !== 'object') refuse(path, `is a ${typeof value}, not JSON`)
    if (depth > AUDIT_DETAIL_MAX_DEPTH) refuse(path, `nests deeper than ${AUDIT_DETAIL_MAX_DEPTH} levels`)
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) checkValue(value[i], `${path}[${i}]`, depth + 1, content)
        return
    }
    checkObject(value, path, depth, content)
}

function checkObject(value: object, path: string, depth: number, content: boolean): void {
    if (!isPlainObject(value)) refuse(path, 'is not a plain object (a Date, a Map or a class instance)')
    if (Object.getOwnPropertySymbols(value).length > 0) refuse(path, 'has a symbol key')
    for (const [key, child] of Object.entries(value)) {
        // An optional property left undefined is absent, as JSON writes it (and as the type allows).
        if (child === undefined) continue
        if (content) checkKey(key, child, path)
        checkValue(child, `${path}.${key}`, depth + 1, content)
    }
}

function checkKey(key: string, child: unknown, path: string): void {
    const keyProblem = stringProblem(key)
    // A key that fails a shape check is not repeated: it may be the very thing refused.
    if (keyProblem) refuse(path, `has a key that ${keyProblem}`)
    const named = secretNamed(key)
    // A flag or a null cannot carry a secret (`missingToken: true`), and a number under a qualified plural
    // counts them (`revokedTokens: 3`). A bare plural's number may be the secret itself (`otps: 482913`).
    if (!named || child === null || typeof child === 'boolean') return
    if (named.plural && named.qualified && typeof child === 'number') return
    refuse(
        `${path}.${key}`,
        named.plural
            ? 'names secrets, and is not a count of them (a number under a key like revokedTokens)'
            : 'names a secret',
    )
}

/**
 * The detail as it will be WRITTEN, or a refusal naming the rule and the path. What the caller handed
 * over is checked for JSON's types first, so nothing is silently converted (a Date to a string, a
 * function dropped). It is then serialized ONCE, and that text is bounded before any pattern reads it.
 * The parsed text is what every content rule checks and what is written: a `toJSON`, a getter or a Proxy
 * can make it differ from what the caller handed over.
 */
function writableDetail(detail: unknown): AuditDetail {
    if (!isTopLevelObject(detail)) refuse('detail', 'is not an object')
    checkObject(detail, 'detail', 1, false)
    let text: unknown
    try {
        text = JSON.stringify(detail)
    } catch {
        refuse('detail', 'cannot be serialized as JSON')
    }
    if (typeof text !== 'string') refuse('detail', 'cannot be serialized as JSON')
    const bytes = new TextEncoder().encode(text).length
    if (bytes > AUDIT_DETAIL_MAX_BYTES)
        refuse('detail', `is ${bytes} bytes of JSON, over the ${AUDIT_DETAIL_MAX_BYTES}-byte bound`)
    const written: unknown = JSON.parse(text)
    if (!isTopLevelObject(written)) refuse('detail', 'is not an object once serialized')
    checkObject(written, 'detail', 1, true)
    return written as AuditDetail
}

export async function recordAuditEvent(db: DbPort, input: AuditEventInput): Promise<void> {
    // Checked before anything opens, so a refused detail never half-writes.
    const detail = input.detail === undefined || input.detail === null ? null : writableDetail(input.detail)
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
                credential_kind: input.credential?.kind ?? null,
                credential_id: input.credential?.id ?? null,
                detail: detail === null ? null : jsonb(detail),
            })
            .execute(),
    )
}

/**
 * The audit fields for an actor: who it is (`principalIdOf`) and the credential it came with. A person
 * actor that states no credential records none (NULL), never a guessed `session`.
 */
export function auditActorOf(actor: Actor): Pick<AuditEventInput, 'actorUserId' | 'credential'> {
    return {
        actorUserId: principalIdOf(actor),
        credential: actor.credential ?? null,
    }
}
