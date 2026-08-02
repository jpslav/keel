import { appJobKinds } from '@app-config/jobs'
import { getTranslations } from 'next-intl/server'
import { DEFAULT_LOCALE, type Locale } from '../core/locale'
import {
    FRAMEWORK_NOTIFICATION_NAMESPACE,
    type NotificationKind,
    type NotificationPayload,
    notificationCopy,
    resolveEnabledChannels,
} from '../core/notifications'
import { canManageOrg, type Role } from '../core/roles'
import { jobKindAndOrg } from '../db/jobs'
import { insertNotification, readPrefRows } from '../db/notifications'
import { orgForId } from '../db/org-lookup'
import { sendTemplate } from '../email/send'
import { NotificationEmail } from '../email/templates/notification-email'
import type { AuthPort, Membership } from '../ports/auth'
import type { DbPort } from '../ports/db'
import type { EmailPort } from '../ports/email'
import { deferAfterResponse } from './defer'
import type { SmsChannel } from './sms'

/**
 * The notification FAN-OUT seam — app-owned server machinery, NOT a vendor port (the same
 * settlement as webhook-dispatch: no vendor SDK is involved; in_app is the db, email is the existing
 * port, sms is the app-owned channel seam). It reads the recipient's prefs, resolves the enabled
 * channels via the PURE core resolver (shared verbatim with the twin), and fans out with PER-CHANNEL
 * FAULT ISOLATION: in_app is written synchronously so the header bell is durable before the response,
 * while email and sms ride deferAfterResponse (post-response in real mode, inline in simulated mode) — which
 * already swallows-and-records failures, so a dead mail provider can never lose the in_app row or block
 * the sms. Producers (the invite / app mutation routes, the job-terminal sites) call this AFTER their own
 * mutation commits, the same after-commit posture as the audit and webhook emissions beside them.
 *
 * Dependencies are INJECTED (db/email/sms + an optional locale resolver) — the runDueSchedules(db, jobs)
 * precedent — so the same code is exercised by unit tests with fakes; the twin re-implements the fan-out
 * in-memory over the shared core resolver rather than importing this server module.
 */
export interface NotifyDeps {
    db: DbPort
    email: EmailPort
    sms: SmsChannel
    /**
     * Optional simulated-mode enrichment: resolve a recipient's preferred locale so their email/SMS render
     * in their language (the digest-email precedent). The auth port's Membership carries no
     * locale, so real mode omits this and copy falls back to the app default — a noted simplification a
     * real instance closes by enriching from its IdP. Never affects in_app (rendered client-side).
     */
    resolveLocale?: (userId: string) => Locale | undefined
}

interface NotifyInput {
    tenantId: string
    orgId: string
    recipientUserId: string
    /** The recipient's email — required to address the `email` channel; absent = skip email. */
    recipientEmail?: string
    /** A display name for the `to` line of the fake SMS (people carry no phone number). */
    recipientName?: string
    kind: NotificationKind
    payload: NotificationPayload
}

/**
 * Fan ONE notification out to one recipient across their enabled channels (per-channel isolated).
 * INTERNAL — producers call the higher-level `notifyAdmins` / `notifyJobTerminal` below; a
 * single-known-recipient producer would export this then.
 */
async function notify(deps: NotifyDeps, input: NotifyInput): Promise<void> {
    const prefs = await readPrefRows(deps.db, input.tenantId, input.orgId, input.recipientUserId)
    const channels = resolveEnabledChannels(prefs, input.kind)

    // in_app — synchronous + durable (the bell must reflect it immediately). Isolated: a failure here
    // is swallowed so it never crashes the producer, and it never depends on email/sms succeeding.
    if (channels.includes('in_app')) {
        try {
            await insertNotification(deps.db, {
                tenantId: input.tenantId,
                orgId: input.orgId,
                recipientUserId: input.recipientUserId,
                kind: input.kind,
                payload: input.payload,
            })
        } catch {
            // The durable channel failing must not lose the deferred channels or crash the request.
        }
    }

    const copy = notificationCopy(input.kind, input.payload)
    const locale = deps.resolveLocale?.(input.recipientUserId) ?? DEFAULT_LOCALE

    // email — deferred (a slow provider must not add request latency); deferAfterResponse isolates
    // failures. Skipped when the recipient has no address to send to.
    if (channels.includes('email') && input.recipientEmail) {
        const to = input.recipientEmail
        await deferAfterResponse(`notify-email:${input.kind}`, async () => {
            // Root translator, not a namespace-scoped one: an APP kind's copy lives in the app's own
            // catalog, so the namespace comes from the copy itself (core/notifications.ts).
            const t = await getTranslations({ locale })
            const ns = copy.namespace ?? FRAMEWORK_NOTIFICATION_NAMESPACE
            await sendTemplate(deps.email, {
                to,
                subject: t(`${ns}.${copy.subjectKey}`, copy.values),
                template: NotificationEmail({
                    labels: {
                        preview: t(`${ns}.${copy.titleKey}`, copy.values),
                        heading: t(`${ns}.${copy.titleKey}`, copy.values),
                        body: t(`${ns}.${copy.bodyKey}`, copy.values),
                        footer: t(`${FRAMEWORK_NOTIFICATION_NAMESPACE}.emailFooter`),
                    },
                }),
            })
        })
    }

    // sms — the fake channel (a recipe adds Twilio). Deferred + isolated like email.
    if (channels.includes('sms')) {
        const to = input.recipientName ?? input.recipientEmail ?? input.recipientUserId
        await deferAfterResponse(`notify-sms:${input.kind}`, async () => {
            const t = await getTranslations({ locale })
            const ns = copy.namespace ?? FRAMEWORK_NOTIFICATION_NAMESPACE
            await deps.sms({
                to,
                body: t(`${ns}.${copy.smsKey}`, copy.values),
                kind: input.kind,
                recipientUserId: input.recipientUserId,
            })
        })
    }
}

/**
 * Fan a notification out to every ADMIN of an org (the recipient decision for org.invited / job.completed
 * and the app's own admin-addressed kinds — see the decision log). `members` is the auth port's
 * listMembers result for
 * the org; admins are its ACTIVE, org-managing members (canManageOrg). `excludeUserId` drops the actor
 * so an inviter isn't told about their own invite. Each admin is notified independently — one bad
 * recipient never stalls the rest (the fan-out already isolates per channel).
 */
export async function notifyAdmins(
    deps: NotifyDeps,
    input: {
        members: Membership[]
        tenantId: string
        orgId: string
        kind: NotificationKind
        payload: NotificationPayload
        excludeUserId?: string
    },
): Promise<number> {
    const admins = input.members.filter(
        (m) => m.status === 'active' && canManageOrg(m.role as Role) && m.id !== input.excludeUserId,
    )
    // Best-effort per recipient: producers call this AFTER their mutation committed, so a notify
    // failure (a prefs read, even the durable insert) must neither 500 a succeeded action nor
    // stall the remaining admins — allSettled keeps that isolation while the admins' independent
    // prefs-read + insert pairs run concurrently instead of serially in the request path.
    const results = await Promise.allSettled(
        admins.map((admin) =>
            notify(deps, {
                tenantId: input.tenantId,
                orgId: input.orgId,
                recipientUserId: admin.id,
                recipientEmail: admin.email,
                recipientName: admin.name ?? admin.email,
                kind: input.kind,
                payload: input.payload,
            }),
        ),
    )
    return results.filter((result) => result.status === 'fulfilled').length
}

/**
 * Fan a notification out to ONE named member of an org — the recipient decision for a kind that is
 * addressed to a person rather than to whoever happens to manage the team — being handed a piece of
 * work is news for the person it was handed to, not for the admins. `members` is the auth port's
 * listMembers result; the recipient must be ACTIVE, and
 * `excludeUserId` drops the actor so assigning something to yourself does not notify you about it.
 *
 * Returns whether anyone was reached, so a producer can tell "no such member" from "notified".
 */
export async function notifyMember(
    deps: NotifyDeps,
    input: {
        members: Membership[]
        tenantId: string
        orgId: string
        recipientUserId: string
        kind: NotificationKind
        payload: NotificationPayload
        excludeUserId?: string
    },
): Promise<boolean> {
    if (input.recipientUserId === input.excludeUserId) return false
    const member = input.members.find((m) => m.status === 'active' && m.id === input.recipientUserId)
    if (!member) return false
    try {
        await notify(deps, {
            tenantId: input.tenantId,
            orgId: input.orgId,
            recipientUserId: member.id,
            recipientEmail: member.email,
            recipientName: member.name ?? member.email,
            kind: input.kind,
            payload: input.payload,
        })
        return true
    } catch {
        // Same posture as notifyAdmins: the notification layer is never load-bearing for the request.
        return false
    }
}

/** Job kinds whose terminal state notifies the team. The app's OWN job kinds (appJobKinds,
 *  the seam) are user-submitted work someone is waiting on; the framework's scheduled kinds (e.g.
 *  digest-email) are internal machinery and would just be noise (see the decision log). */
const NOTIFIED_JOB_KINDS = new Set<string>(appJobKinds)

/**
 * Notify a job's org admins that a user-facing job reached a terminal state. Jobs carry no
 * creator column, so the org's admins are the recipients (the recorded decision). Resolves the job's
 * kind + org itself from (tenantId, jobId) so both terminal sites — the fake in-process executor and
 * the real completion webhook — call it with the same three facts. A no-op for internal job kinds, a
 * job with no org, or an unknown job/org. Called AFTER the terminal status commits, like the webhook
 * emission beside it.
 */
export async function notifyJobTerminal(
    deps: NotifyDeps,
    authPort: AuthPort,
    input: { tenantId: string; jobId: string; status: 'completed' | 'failed' },
): Promise<void> {
    // Best-effort end to end: this path adds an EXTERNAL failure surface (listMembers is a real IdP
    // call in real mode) after the terminal status already committed — a throw here would 500 the
    // completion webhook into a vendor retry that then no-ops as idempotent, silently losing the
    // notification AND lying to the vendor. Swallow instead; the job outcome itself is already durable.
    try {
        const job = await jobKindAndOrg(deps.db, input.tenantId, input.jobId)
        if (!job || job.orgId === null || !NOTIFIED_JOB_KINDS.has(job.kind)) return
        const org = await orgForId(deps.db, job.orgId)
        if (!org) return
        const members = await authPort.listMembers(org.slug)
        await notifyAdmins(deps, {
            members,
            tenantId: input.tenantId,
            orgId: job.orgId,
            kind: 'job.completed',
            payload: { jobId: input.jobId, jobKind: job.kind, status: input.status },
        })
    } catch {
        // Swallowed by design — see above.
    }
}
