import { normalizeEmailAddress, normalizeInboundBody, parseInboundRecipient } from '../core/inbound-email'
import { recordAuditEvent } from '../db/audit'
import {
    insertInboundEmail,
    resolveOrgBySlugGlobally,
    setInboundStatus,
    type ResolvedInboundOrg,
} from '../db/inbound-email'
import type { AuthPort } from '../ports/auth'
import type { DbPort } from '../ports/db'
import { inboundHandlers } from './handlers'

/**
 * THE inbound-email intake — the single function BOTH entry points feed: the real Mailgun
 * webhook route (after signature verification) and the fake Simulator "compose inbound" route (simulated-mode
 * gated, no signature — the honest mechanism; it calls this directly rather than spoofing a signature).
 *
 * Pipeline: parse the recipient → resolve the org (and thus tenant) globally → file a 'received' row →
 * run the address's handler inside its tenant → record the final status. The FILE-then-run order keeps
 * the message durable even if the handler throws.
 *
 * FAULT ISOLATION / POISON MESSAGES. A handler THROW is caught here → status 'failed', the row KEPT, and
 * the caller returns 200. Mailgun retries a non-2xx for hours, so a permanently-broken (poison) message
 * must never surface as a 5xx or it retries forever — the failure is recorded, not re-raised. Genuine
 * INFRASTRUCTURE failures (the row insert itself throwing) DO propagate → a real 500 → an appropriate
 * Mailgun retry. See the decision log.
 *
 * UNRESOLVED TENANT. If the recipient doesn't parse, or its org slug resolves to zero/multiple orgs,
 * there is no tenant to anchor an RLS row under — the single-domain template has no domain→tenant map —
 * so intake returns an unstored 'unmatched' outcome (the caller still 200s). A real MULTI-domain instance
 * resolves the tenant from the domain and CAN file such a row with org_id NULL (why the column is
 * NULLable). Recorded honestly in the decision log.
 *
 * AUDIT. Every STORED row records an `inbound-email.received` event (subject 'InboundEmail'); an app's
 * handler additionally records its own domain verb, so what it produced appears in the audit trail exactly as
 * a UI-created one would.
 */

const SYSTEM_ACTOR = 'system:inbound-email'

export interface IntakeInput {
    to: string
    from: string
    subject: string
    bodyText: string
    bodyHtml?: string | null
}

export interface IntakeOutcome {
    stored: boolean
    id: string | null
    status: 'handled' | 'unmatched' | 'failed'
    handler: string | null
    reason?: string
    /** On 'handled': the row the handler created, when its result named one (InboundHandlerResult). */
    subjectId?: string | null
}

async function auditReceived(db: DbPort, org: ResolvedInboundOrg, emailId: string, actorUserId: string): Promise<void> {
    await recordAuditEvent(db, {
        tenantId: org.tenantId,
        orgId: org.orgId,
        actorUserId,
        action: 'inbound-email.received',
        subjectType: 'InboundEmail',
        subjectId: emailId,
    })
}

export async function intakeInboundEmail(db: DbPort, auth: AuthPort, input: IntakeInput): Promise<IntakeOutcome> {
    const fromEmail = normalizeEmailAddress(input.from) || input.from.trim().toLowerCase()
    const toEmail = normalizeEmailAddress(input.to) || input.to.trim().toLowerCase()
    const subject = input.subject ?? ''
    const bodyText = normalizeInboundBody(input.bodyText ?? '')

    const parsed = parseInboundRecipient(input.to)
    if (!parsed) {
        return { stored: false, id: null, status: 'unmatched', handler: null, reason: 'unparseable recipient' }
    }
    const org = await resolveOrgBySlugGlobally(db, parsed.orgSlug)
    if (!org) {
        return {
            stored: false,
            id: null,
            status: 'unmatched',
            handler: null,
            reason: `org not resolved: ${parsed.orgSlug}`,
        }
    }

    // File the durable 'received' row first (infra failure here propagates → real 500 → Mailgun retry).
    const { id } = await insertInboundEmail(db, {
        tenantId: org.tenantId,
        orgId: org.orgId,
        fromEmail,
        toEmail,
        subject,
        bodyText,
        bodyHtml: input.bodyHtml ?? null,
    })

    const handler = inboundHandlers[parsed.handler] ?? null
    if (!handler) {
        await setInboundStatus(db, org.tenantId, id, {
            status: 'unmatched',
            handler: null,
            error: `no handler: ${parsed.handler}`,
        })
        await auditReceived(db, org, id, SYSTEM_ACTOR)
        return { stored: true, id, status: 'unmatched', handler: null, reason: `no handler: ${parsed.handler}` }
    }

    try {
        const result = await handler({
            db,
            auth,
            tenantId: org.tenantId,
            orgId: org.orgId,
            orgSlug: org.orgSlug,
            fromEmail,
            subject,
            bodyText,
            emailId: id,
        })
        if (result.status === 'handled') {
            await setInboundStatus(db, org.tenantId, id, { status: 'handled', handler: parsed.handler, error: null })
            await auditReceived(db, org, id, result.actorUserId)
            return { stored: true, id, status: 'handled', handler: parsed.handler, subjectId: result.subjectId ?? null }
        }
        await setInboundStatus(db, org.tenantId, id, {
            status: 'unmatched',
            handler: parsed.handler,
            error: result.reason,
        })
        await auditReceived(db, org, id, SYSTEM_ACTOR)
        return { stored: true, id, status: 'unmatched', handler: parsed.handler, reason: result.reason }
    } catch (error) {
        // Poison-message isolation: record 'failed', keep the row, do NOT re-raise (the caller 200s).
        const message = error instanceof Error ? error.message : String(error)
        await setInboundStatus(db, org.tenantId, id, { status: 'failed', handler: parsed.handler, error: message })
        await auditReceived(db, org, id, SYSTEM_ACTOR)
        return { stored: true, id, status: 'failed', handler: parsed.handler, reason: message }
    }
}
