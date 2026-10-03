import { flags as appSimulatorFlags } from '@app-config/simulator'
import {
    agreements as seedAgreements,
    findOrg,
    jobSchedules as seedJobSchedules,
    findTenant,
    organizations,
    people,
    tenants,
    type PersonRole,
    type SeedPerson,
} from '@app-config/seed'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActorLog } from '../components/simulator/actor-runtime'
import type { SimulatorNotice } from '../components/simulator/simulator-panel'
import type { Person } from '../components/simulator/people-app'
import type { AnalyticsEvent, AuditEntry } from '../components/simulator/events-app'
import type { InboundComposeInput, InboundEmailRow } from '../components/simulator/inbound-app'
import type { ScheduleRowLike } from '../components/simulator/jobs-app'
import type { MailItem } from '../components/simulator/mail-app'
import type { SmsMessageRow } from '../components/simulator/messages-app'
import {
    type AcceptanceView,
    type AgreementView,
    agreementFacts,
    computePendingAgreements,
    gatesForAgreements,
    pendingAgreementForGateId,
} from '../core/agreements'
import { advisoryGates, evaluateGates, firstBlockingGate } from '../core/gates'
import {
    DEMO_INBOUND_DOMAIN,
    formatInboundRecipient,
    normalizeEmailAddress,
    normalizeInboundBody,
    parseInboundRecipient,
} from '../core/inbound-email'
import {
    type NotificationKind,
    type NotificationPayload,
    type NotificationPrefRow,
    FRAMEWORK_NOTIFICATION_NAMESPACE,
    notificationCopy,
    resolveEnabledChannels,
} from '../core/notifications'
import { canManageOrg, isAssignableRole } from '../core/roles'
import { computeNextRunAt } from '../core/schedules'
import {
    backoffDelayMs,
    MAX_DELIVERY_ATTEMPTS,
    type WebhookEventKind,
    type WebhookEventPayload,
} from '../core/webhook-events'
import { webhookSignatureHeader } from '../core/webhook-signing'
import { createDemoBuilderDriver, createDemoServiceDriver, type DemoServiceScope } from './actor-drivers'
import type { DemoWorld, DemoWorldOptions } from './contracts'
import { buildDigestEmailHtml, buildInviteEmailHtml } from './email-html'
import { go, useHashRoute } from './hash-route'
import type {
    DemoAcceptance,
    DemoAgreement,
    DemoDelivery,
    DemoEndpoint,
    DemoInvite,
    DemoJob,
    DemoNotification,
} from './rows'
/**
 * THE in-memory framework world for the `file://` static demo (ADR-0006, ADR-0012). Everything the
 * framework owns a table (or a `.data/` file) for on the server exists here as React state, mutated by
 * twins of the same server operations and read by the SAME router-agnostic screens and the SAME pure
 * `core/` logic. No server, no database, no fetch — which is exactly what makes it shareable as one
 * HTML file, and what forces the handful of DEGRADEs marked below.
 *
 * The line this file sits on: everything here is FRAMEWORK — auth/invites/people, mail, inbound mail,
 * notifications and prefs, jobs and schedules, the world clock, webhooks, agreements, audit, analytics,
 * feature flags, the people/viewpoint/continuity model. An app's OWN tables stay in its composition root
 * (src/demo-static/app.tsx), which calls this hook, adds its rows, and renders ./shell.tsx. Where the
 * framework genuinely needs app vocabulary it comes through the ADR-0012 seam (`@app-config/*`) or
 * through DemoWorldOptions — never from `@/*`, which the fence bans outright.
 */

/** How long a Simulator notice stays up. */
const NOTICE_MS = 6_000

/** Fixed historical instant for seeded pre-acceptances (render-pure; shown only as a date). */
const SEED_ACCEPTED_AT = '2026-01-01T00:00:00.000Z'

/** The seeded weekly digest schedule (twin of ../db/seed.ts): research team, Monday 13:00 UTC. */

/** How many recent rows the digest lists, and the snippet length used as each row's "title" —
 *  the same two constants ../jobs/digest-email.ts uses. */
const DIGEST_RECENT_LIMIT = 5
const DIGEST_SNIPPET_LENGTH = 60

/** Attribution for intake events no handler claimed (twin of ../inbound-email/intake.ts). */
const INBOUND_SYSTEM_ACTOR = 'system:inbound-email'

/**
 * The Snapshots knobs, off at world start — the twin of KNOWN_FLAGS in ../adapters/fake/analytics.ts, and
 * composed the same way: the framework's own two, plus whatever the app registered on the seam. An app
 * flag that only existed server-side would be a knob the `file://` demo could not reach.
 */
const INITIAL_FLAGS: Record<string, boolean> = {
    'demo-banner': false,
    'jobs-held': false,
    ...Object.fromEntries(appSimulatorFlags.map((flag) => [flag.id, false])),
}

const DEFAULT_ACTIVE_ORG = organizations[0]!.slug

/** Truncating snippet used as a row's "title" in the digest (twin of the real handler's `snippet`). */
function digestSnippet(body: string): string {
    const oneLine = body.replace(/\s+/g, ' ').trim()
    return oneLine.length > DIGEST_SNIPPET_LENGTH ? `${oneLine.slice(0, DIGEST_SNIPPET_LENGTH - 1)}…` : oneLine
}

/** A team's digest recipient (twin of the real handler's digestRecipient): its admin, else its first
 *  member, else a synthetic per-org address. */
function digestRecipientEmail(orgSlug: string): string {
    const members = people.filter((p) => p.memberships.some((m) => m.orgSlug === orgSlug))
    const admin = members.find((p) => p.memberships.some((m) => m.orgSlug === orgSlug && m.role === 'admin'))
    return (admin ?? members[0])?.email ?? `${orgSlug}@digest.example`
}

function makeSeedAgreements(): DemoAgreement[] {
    return seedAgreements.map((a) => ({
        id: `agr-${a.tenantSlug}-${a.kind}`,
        tenantSlug: a.tenantSlug,
        kind: a.kind,
        version: a.version,
        title: a.title,
        bodyMd: a.bodyMd,
        gating: a.gating,
    }))
}

/** Seed the pre-acceptances that keep the world unblocked: every person in a tenant pre-accepts that
 *  tenant's `preAcceptedByAllInTenant` agreement at v1 (the alpha ToS), so nothing blocks until a bump.
 *  An agreement accepted by nobody is how the advisory banner gets something to show. */
function makeSeedAcceptances(): DemoAcceptance[] {
    const rows: DemoAcceptance[] = []
    for (const a of seedAgreements) {
        if (!a.preAcceptedByAllInTenant) continue
        const id = `agr-${a.tenantSlug}-${a.kind}`
        for (const p of people.filter((person) => person.tenantSlug === a.tenantSlug)) {
            rows.push({ agreementId: id, userId: p.id, version: a.version, acceptedAt: SEED_ACCEPTED_AT })
        }
    }
    return rows
}

/**
 * Twin of the framework seeder's job_schedules pass (../db/seed.ts): whatever the APP's seed data
 * says, computed forward from now. It used to be one hard-coded row carrying one app's slugs — which
 * meant the `file://` demo silently showed a different schedule list from `pnpm dev` the moment the
 * app seeded a second one.
 */
function makeSeedSchedules(): ScheduleRowLike[] {
    return seedJobSchedules.map((schedule, index) => ({
        id: `seed-schedule-${index}`,
        kind: schedule.kind,
        spec: schedule.spec,
        nextRunAt: computeNextRunAt(schedule.spec, new Date()).toISOString(),
        enabled: true,
        tenantSlug: schedule.tenantSlug,
        orgSlug: schedule.orgSlug,
    }))
}

/** Demo-only signing secret: a random hex string, shown once on create (twin of the server's
 *  randomBytes secret). crypto.getRandomValues runs from file://, so this is real randomness. */
function makeWebhookSecret(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(24))
    return `whsec_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

/** Resolve a person's role for one org, falling back to their first membership when the slug isn't
 *  (or is no longer) one they belong to — mirrors resolveMembership in the fake adapter. */
function roleInOrg(person: SeedPerson, orgSlug: string): PersonRole {
    return person.memberships.find((m) => m.orgSlug === orgSlug)?.role ?? person.memberships[0].role
}

/** Turn the composition root's seeded outbox into MailItems (ids and timestamps are ours). */
function seededMail(initial: DemoWorldOptions['initialMail']): MailItem[] {
    return (initial ?? []).map((mail, index) => ({
        id: `seed-mail-${index}`,
        to: mail.to,
        subject: mail.subject,
        html: mail.html,
        at: new Date().toISOString(),
    }))
}

export function useDemoWorld(options: DemoWorldOptions = {}): DemoWorld {
    const { inboundHandlers = {}, digestBodies, onReset } = options
    const route = useHashRoute()
    const tEmail = useTranslations('email')
    const tSimulator = useTranslations('simulator')
    const tOrg = useTranslations('org')
    const tNotifications = useTranslations('notifications')
    const tRoot = useTranslations()

    const [person, setPerson] = useState<SeedPerson | null>(null)
    const [inviteError, setInviteError] = useState<string | null>(null)
    const [activeOrgSlug, setActiveOrgSlug] = useState(DEFAULT_ACTIVE_ORG)
    const [displayName, setDisplayName] = useState<string | null>(null)
    const [emails, setEmails] = useState<MailItem[]>(() => seededMail(options.initialMail))
    const [invites, setInvites] = useState<DemoInvite[]>([])
    // People created by accepting an invite (Bob's lifecycle) — merged with the seed list
    // everywhere the seed list used to stand alone: People, the sign-in picker, the org member list.
    const [dynamicPeople, setDynamicPeople] = useState<SeedPerson[]>([])
    // The Simulator viewpoint when NO ONE is signed in (an invited-but-unregistered person's
    // "desktop": signed-out main pane + their inbox in the panel). Cleared whenever a real
    // person signs in; real sign-ins always derive their viewpoint from `person` instead.
    const [invitedViewpoint, setInvitedViewpoint] = useState<string | null>(null)
    const [events, setEvents] = useState<AnalyticsEvent[]>([])
    // Twin of the audit_events table — appended by the twin's own mutations, shown read-only in the
    // Simulator Events tab beneath the analytics events (full parity: audit is just rows).
    const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
    const [flags, setFlags] = useState<Record<string, boolean>>(INITIAL_FLAGS)
    const [jobs, setJobs] = useState<DemoJob[]>([])
    // Twin of the inbound_emails table — the world's received mail, drives the Simulator Mail-tab
    // inbound list. Filed by composeInbound below (the twin of intakeInboundEmail).
    const [inbound, setInbound] = useState<InboundEmailRow[]>([])
    // Twins of webhook_endpoints / webhook_deliveries + the fake failure toggle set.
    const [endpoints, setEndpoints] = useState<DemoEndpoint[]>([])
    const [deliveries, setDeliveries] = useState<DemoDelivery[]>([])
    const [failingEndpoints, setFailingEndpoints] = useState<Set<string>>(() => new Set())
    // The secret to show exactly once, right after creating an endpoint (twin of the create response).
    const [newWebhookSecret, setNewWebhookSecret] = useState<string | null>(null)
    // Twins of the notification fan-out: the notifications rows (header bell), the fake-SMS
    // catch-store (Simulator Messages tab), and per-(person:org) preference rows (opt-out).
    const [notifications, setNotifications] = useState<DemoNotification[]>([])
    const [smsMessages, setSmsMessages] = useState<SmsMessageRow[]>([])
    const [notifPrefs, setNotifPrefs] = useState<Record<string, NotificationPrefRow[]>>({})
    // Twin of the job_schedules table — seeded with the weekly research digest.
    const [schedules, setSchedules] = useState<ScheduleRowLike[]>(() => makeSeedSchedules())
    // Twins of the agreements + agreement_acceptances tables — the access-gate worked example.
    const [agreements, setAgreements] = useState<DemoAgreement[]>(() => makeSeedAgreements())
    const [acceptances, setAcceptances] = useState<DemoAcceptance[]>(() => makeSeedAcceptances())
    // Twin of the fake world-clock offset (.data/simulator/clock.json) — mount time + this = world "now".
    const [clockOffsetMs, setClockOffsetMs] = useState(0)
    // A fixed real-time anchor captured once at mount (lazy init — the one place an impure read is
    // allowed). The seed schedule's next_run_at was computed from ~this same instant, so firing and the
    // world-clock DISPLAY both read `mountedAtMs + offset`, keeping them consistent and render-pure.
    const [mountedAtMs] = useState(() => Date.now())
    const [mailScope, setMailScope] = useState<'person' | 'all'>('person')
    // Twin of mailSeenAt (the real app persists this to .data/simulator/state.json, keyed by PersonKey).
    const [mailSeenAt, setMailSeenAt] = useState<Record<string, string>>({})
    const [notices, setNotices] = useState<SimulatorNotice[]>([])
    const noticeSeq = useRef(0)
    // Continuity twin (ADR-0006): the real app persists this to .data/simulator/state.json; with no
    // server an in-memory map keyed by person id stands in for it.
    const continuityMap = useRef(new Map<string, { route: string; org: string }>())
    // Always-current mirror of `jobs` for the actor drivers: refs may not be written during render
    // (react-hooks/refs), so an effect keeps it in sync instead — the drivers read through the ref
    // rather than a stale closure, so they never need rebuilding when a tick fires.
    const jobsRef = useRef<DemoJob[]>(jobs)
    useEffect(() => {
        jobsRef.current = jobs
    }, [jobs])

    const allPeople = [...people, ...dynamicPeople]
    const org = organizations.find((o) => o.slug === activeOrgSlug) ?? organizations[0]!
    // The tenant (ambient site) is never user-switchable — it follows whoever's signed in, not the
    // active org (orgs never span tenants, so this always agrees with the active org's own site).
    const tenant = findTenant(person ? person.tenantSlug : org.tenantSlug) ?? tenants[0]!
    const name = displayName ?? person?.name ?? ''

    function pushNotice(text: string) {
        const id = (noticeSeq.current += 1)
        setNotices((prev) => [...prev, { id, text }])
        setTimeout(() => setNotices((prev) => prev.filter((notice) => notice.id !== id)), NOTICE_MS)
    }

    function logEvent(event: string, properties?: Record<string, unknown>) {
        setEvents((prev) => [{ id: `evt-${prev.length}`, at: new Date().toISOString(), event, properties }, ...prev])
    }

    /** Twin of recordAuditEvent (../db/audit.ts): append a compliance-record row for the active
     *  tenant/org and whoever's signed in — the same who/what/when the real routes write post-mutation. */
    function logAudit(action: string, subjectType: string, subjectId: string | null) {
        appendAudit({ action, subjectType, subjectId, actorUserId: person?.id ?? '' }, tenant.slug, activeOrgSlug)
    }

    /** The same append, for a mutation whose tenant/org is RESOLVED rather than ambient (inbound mail
     *  files into the addressed team, not the team you happen to be looking at). */
    function appendAudit(
        entry: { action: string; subjectType: string; subjectId: string | null; actorUserId: string },
        tenantSlug: string,
        orgSlug: string,
        at = new Date().toISOString(),
    ) {
        setAuditEntries((prev) => [{ id: `audit-${prev.length}`, at, ...entry, tenantSlug, orgSlug }, ...prev])
    }

    // ── Access gates — the twin of the protected-layout gate evaluation ───────────────────────────
    // Drives the SAME pure core (computePendingAgreements → gatesForAgreements → evaluateGates) the real
    // server runs, over the in-memory agreements/acceptances. Full parity; the only "degrade" is that
    // accept updates state in place instead of POST + reload.
    const tenantAgreements: AgreementView[] = agreements
        .filter((a) => a.tenantSlug === tenant.slug)
        .map((a) => ({
            id: a.id,
            kind: a.kind,
            version: a.version,
            title: a.title,
            bodyMd: a.bodyMd,
            gating: a.gating,
        }))
    const myAcceptances: AcceptanceView[] = person
        ? acceptances
              .filter((x) => x.userId === person.id)
              .map((x) => ({ agreementId: x.agreementId, version: x.version, acceptedAt: x.acceptedAt }))
        : []
    const pendingAgreements = computePendingAgreements(tenantAgreements, myAcceptances)
    const pendingGates = evaluateGates(gatesForAgreements(tenantAgreements), agreementFacts(pendingAgreements))
    const blockingGate = firstBlockingGate(pendingGates)
    const blockingAgreement = blockingGate ? pendingAgreementForGateId(blockingGate.id, pendingAgreements) : undefined
    const advisoryAgreements = advisoryGates(pendingGates).flatMap((gate) => {
        const agreement = pendingAgreementForGateId(gate.id, pendingAgreements)
        return agreement ? [agreement] : []
    })

    /** Accept an agreement for the signed-in person (twin of POST /api/agreements/accept): append an
     *  acceptance row at the agreement's CURRENT version + audit it. Re-render clears the gate naturally. */
    function acceptAgreement(agreementId: string) {
        if (!person) return
        const agreement = agreements.find((a) => a.id === agreementId)
        if (!agreement) return
        setAcceptances((prev) => [
            ...prev,
            { agreementId, userId: person.id, version: agreement.version, acceptedAt: new Date().toISOString() },
        ])
        logAudit('agreement.accepted', 'AgreementAcceptance', agreementId)
    }

    /** Bump an agreement's version (twin of the Simulator bump god op): re-arms the gate for everyone
     *  whose latest acceptance is now stale. */
    function bumpAgreement(id: string) {
        const current = agreements.find((a) => a.id === id)
        if (!current) return
        setAgreements((prev) => prev.map((a) => (a.id === id ? { ...a, version: a.version + 1 } : a)))
        pushNotice(tSimulator('noticeAgreementBumped', { version: current.version + 1 }))
    }

    // ── Notification fan-out ──────────────────────────────────────────────────────────────────────

    /**
     * Twin of the server notification fan-out (../server-lib/notify.ts): resolve the recipient's enabled
     * channels via the SHARED core resolver (opt-out / default-on) and emit on each one — an in-app
     * `notifications` row (the header bell), a MailItem (the same catch-store the invite email lands in),
     * and a fake-SMS row (the Simulator Messages tab). The email + SMS copy comes from the SHARED core
     * `notificationCopy` mapper, so the bell, the email, and the SMS can never drift.
     */
    function notifyPerson(
        recipient: SeedPerson,
        orgSlug: string,
        kind: NotificationKind,
        payload: NotificationPayload,
    ) {
        const prefs = notifPrefs[`${recipient.id}:${orgSlug}`] ?? []
        const channels = resolveEnabledChannels(prefs, kind)
        if (channels.includes('in_app')) {
            setNotifications((prev) => [
                {
                    id: crypto.randomUUID(),
                    recipientPersonId: recipient.id,
                    orgSlug,
                    kind,
                    payload,
                    readAt: null,
                    createdAt: new Date().toISOString(),
                },
                ...prev,
            ])
        }
        if (channels.includes('email') || channels.includes('sms')) {
            const copy = notificationCopy(kind, payload)
            // Same rule as the server: an app kind's copy resolves in the app catalog's namespace.
            const c = (key: string, values?: Record<string, string>) =>
                tRoot(`${copy.namespace ?? FRAMEWORK_NOTIFICATION_NAMESPACE}.${key}`, values)
            if (channels.includes('email')) {
                const html =
                    `<h2>${c(copy.titleKey, copy.values)}</h2>` +
                    `<p>${c(copy.bodyKey, copy.values)}</p>` +
                    `<p>${tNotifications('emailFooter')}</p>`
                setEmails((prev) => [
                    {
                        id: `email-${prev.length}`,
                        to: recipient.email,
                        subject: c(copy.subjectKey, copy.values),
                        html,
                        at: new Date().toISOString(),
                    },
                    ...prev,
                ])
            }
            if (channels.includes('sms')) {
                setSmsMessages((prev) => [
                    {
                        id: crypto.randomUUID(),
                        to: recipient.name,
                        body: c(copy.smsKey, copy.values),
                        kind,
                        at: new Date().toISOString(),
                    },
                    ...prev,
                ])
            }
        }
    }

    /**
     * Twin of notifyMember: fan a notification to ONE named member of `orgSlug` — the recipient shape
     * for a kind addressed to a person rather than to whoever manages the team. `excludePersonId`
     * drops the actor, so handing something to yourself notifies nobody.
     */
    function notifyMemberOf(
        orgSlug: string,
        recipientPersonId: string,
        kind: NotificationKind,
        payload: NotificationPayload,
        excludePersonId?: string,
    ) {
        if (recipientPersonId === excludePersonId) return
        const recipient = allPeople.find(
            (p) => p.id === recipientPersonId && p.memberships.some((m) => m.orgSlug === orgSlug),
        )
        if (recipient) notifyPerson(recipient, orgSlug, kind, payload)
    }

    /** Twin of notifyAdmins: fan a notification to every person who is an ACTIVE member of `orgSlug`
     *  with a role that passes canManageOrg, optionally excluding the acting person (org.invited
     *  addresses the inviter's peers, not the inviter). */
    function notifyAdminsOf(
        orgSlug: string,
        kind: NotificationKind,
        payload: NotificationPayload,
        excludePersonId?: string,
    ) {
        for (const p of allPeople) {
            if (p.id === excludePersonId) continue
            if (!p.memberships.some((m) => m.orgSlug === orgSlug)) continue
            if (!canManageOrg(roleInOrg(p, orgSlug))) continue
            notifyPerson(p, orgSlug, kind, payload)
        }
    }

    /**
     * Twin of notifyJobTerminal: a user-facing job reaching a terminal state notifies its OWN team's
     * admins (jobs carry no creator column, so the team's admins are the recipients).
     *
     * The server gates this on NOTIFIED_JOB_KINDS — `appJobKinds`, i.e. "kinds the app registered are
     * work someone submitted and is waiting on; the framework's scheduled kinds are internal machinery
     * and would just be noise" (see the decision log). The twin gets the same gate STRUCTURALLY rather
     * than from a list: only startJob puts a job in the queue, and it is the composition root's twin of
     * a user submitting work, while runDueSchedules spawns its jobs already completed. So the two call
     * sites below ARE the app-submitted kinds. Importing the seam's registry to re-derive that would
     * have dragged every server handler's db/email dependencies into a bundle that has neither.
     */
    function notifyJobTerminal(job: { id: string; kind: string; orgSlug: string | null }) {
        if (job.orgSlug === null) return
        notifyAdminsOf(job.orgSlug, 'job.completed', { jobId: job.id, jobKind: job.kind, status: 'completed' })
    }

    // ── Outbound webhooks ─────────────────────────────────────────────────────────────────────────

    /** Twin of enqueueWebhookEvent: fan an event to a pending delivery per matching enabled endpoint in
     *  the ACTIVE org (endpoints are org-scoped). next_attempt is world-now, so a drain fires it at once. */
    function enqueueWebhook(kind: WebhookEventKind, payload: WebhookEventPayload) {
        const worldNowMs = mountedAtMs + clockOffsetMs
        const matching = endpoints.filter(
            (e) =>
                e.tenantSlug === tenant.slug && e.orgSlug === activeOrgSlug && e.enabled && e.eventKinds.includes(kind),
        )
        if (matching.length === 0) return
        const created: DemoDelivery[] = matching.map((endpoint) => ({
            id: crypto.randomUUID(),
            endpointId: endpoint.id,
            tenantSlug: endpoint.tenantSlug,
            orgSlug: endpoint.orgSlug,
            eventKind: kind,
            payload,
            status: 'pending',
            attemptCount: 0,
            nextAttemptAtMs: worldNowMs,
            lastError: null,
            createdAtMs: worldNowMs,
            deliveredAtMs: null,
            signature: null,
            body: null,
        }))
        setDeliveries((prev) => [...created, ...prev])
    }

    /** Twin of runDueDeliveries: attempt each due pending/failed delivery, signing the envelope with the
     *  REAL core signer; a toggled-failing endpoint fails and re-arms on the SAME backoff the server
     *  uses, marking 'dead' at MAX_DELIVERY_ATTEMPTS. Reads current state from the closure (the house
     *  pattern here, like runDueSchedules). Returns how many were delivered. */
    function runDueDeliveries(worldNowMs: number): number {
        let delivered = 0
        const next = deliveries.map((delivery) => {
            if (!['pending', 'failed'].includes(delivery.status) || delivery.nextAttemptAtMs > worldNowMs) {
                return delivery
            }
            const endpoint = endpoints.find((e) => e.id === delivery.endpointId)
            const attempt = delivery.attemptCount + 1
            if (!endpoint || !endpoint.enabled) {
                return { ...delivery, status: 'dead', attemptCount: attempt, lastError: 'endpoint disabled' }
            }
            const body = JSON.stringify({
                id: delivery.id,
                kind: delivery.eventKind,
                createdAt: new Date(delivery.createdAtMs).toISOString(),
                data: delivery.payload,
            })
            const signature = webhookSignatureHeader(endpoint.secret, body, Math.floor(worldNowMs / 1000))
            if (!failingEndpoints.has(endpoint.id)) {
                delivered += 1
                return {
                    ...delivery,
                    status: 'delivered',
                    attemptCount: attempt,
                    deliveredAtMs: worldNowMs,
                    lastError: null,
                    signature,
                    body,
                }
            }
            const dead = attempt >= MAX_DELIVERY_ATTEMPTS
            return {
                ...delivery,
                status: dead ? 'dead' : 'failed',
                attemptCount: attempt,
                nextAttemptAtMs: worldNowMs + backoffDelayMs(attempt),
                lastError: 'fake failure toggle',
                signature,
                body,
            }
        })
        setDeliveries(next)
        return delivered
    }

    // ── Jobs, schedules and the world clock ───────────────────────────────────────────────────────

    /**
     * Twin of POST /api/jobs + fakeJobs.start: when the 'jobs-held' knob is on the job stays 'queued'
     * for a later Run-pending step; otherwise it completes instantly with the full
     * queued → running → completed story (a few hundred ms apart, exactly like the fake adapter) and
     * emits what the terminal path emits server-side — the job.status_changed webhook recordJobStatus
     * sends, and the org-admin notification notifyJobTerminal sends.
     * DEGRADE: no downloadUrl — the static shell has no server to serve result bytes (physics forbid).
     */
    function startJob(kind: string) {
        // One wall-clock read for the whole timeline, so the three hops are a fixed few hundred ms
        // apart rather than however long React took between them (an event handler, not render, so
        // reading the clock here is correct).
        const now = Date.now()
        const iso = (offset: number) => new Date(now + offset).toISOString()
        const held = flags['jobs-held'] ?? false
        const base = {
            id: crypto.randomUUID(),
            kind,
            tenantSlug: tenant.slug,
            orgSlug: activeOrgSlug,
            createdAt: iso(0),
            error: null,
        }
        const job: DemoJob = held
            ? { ...base, status: 'queued', timeline: [{ status: 'queued', at: iso(0) }] }
            : {
                  ...base,
                  status: 'completed',
                  timeline: [
                      { status: 'queued', at: iso(0) },
                      { status: 'running', at: iso(200) },
                      { status: 'completed', at: iso(400) },
                  ],
              }
        setJobs((prev) => [job, ...prev])
        // Held jobs stay queued (no terminal transition), so they emit later — from the Run-pending
        // step below, or from an actor claiming them.
        if (held) return
        enqueueWebhook('job.status_changed', {
            jobId: base.id,
            jobKind: kind,
            status: 'completed',
            orgId: activeOrgSlug,
        })
        notifyJobTerminal(job)
    }

    /**
     * Simulator "Run pending jobs" twin: advance every queued job to completed with the full timeline,
     * then fire each one's terminal notification. Pure in-memory logic (no server), so this is genuine
     * parity — not a degrade.
     */
    function runPendingJobs() {
        const completing = jobs.filter((job) => job.status === 'queued')
        setJobs((prev) =>
            prev.map((job) => {
                if (job.status !== 'queued') return job
                const now = Date.now()
                return {
                    ...job,
                    status: 'completed',
                    timeline: [
                        ...job.timeline,
                        { status: 'running', at: new Date(now).toISOString() },
                        { status: 'completed', at: new Date(now + 200).toISOString() },
                    ],
                }
            }),
        )
        for (const job of completing) {
            // The same terminal hop startJob's non-held branch takes, so it emits the same pair the
            // server's recordJobStatus does: the webhook first, then the admin notification (both
            // skip an org-less job, as notifyJobTerminal already does).
            if (job.orgSlug !== null) {
                enqueueWebhook('job.status_changed', {
                    jobId: job.id,
                    jobKind: job.kind,
                    status: 'completed',
                    orgId: job.orgSlug,
                })
            }
            notifyJobTerminal(job)
        }
        pushNotice(tSimulator('noticeJobsRan', { count: completing.length }))
    }

    /**
     * Twin of runDueSchedules: fire every enabled schedule due at the given world "now" — spawn a
     * digest-email job (completed inline) and land the digest in the Mail store — then advance
     * next_run_at, coalescing missed periods so a big clock jump fires once, never once per skipped
     * week. Reads current schedules from the render closure (the house pattern here); returns how many
     * fired. Genuine parity — schedules are just rows plus pure core.
     */
    function runDueSchedules(worldNowMs: number): number {
        const fired: ScheduleRowLike[] = []
        const advanced = schedules.map((schedule) => {
            if (!schedule.enabled || new Date(schedule.nextRunAt).getTime() > worldNowMs) return schedule
            fired.push(schedule)
            let next = computeNextRunAt(schedule.spec, new Date(schedule.nextRunAt))
            for (let i = 0; next.getTime() <= worldNowMs && i < 100_000; i++)
                next = computeNextRunAt(schedule.spec, next)
            if (next.getTime() <= worldNowMs) next = computeNextRunAt(schedule.spec, new Date(worldNowMs))
            return { ...schedule, nextRunAt: next.toISOString() }
        })
        if (fired.length === 0) return 0
        setSchedules(advanced)

        const iso = new Date(worldNowMs).toISOString()
        const newJobs: DemoJob[] = []
        const newEmails: MailItem[] = []
        for (const schedule of fired) {
            const jobId = crypto.randomUUID()
            newJobs.push({
                id: jobId,
                kind: 'digest-email',
                status: 'completed',
                tenantSlug: schedule.tenantSlug,
                orgSlug: schedule.orgSlug,
                createdAt: iso,
                error: null,
                timeline: [
                    { status: 'queued', at: iso, message: 'scheduled' },
                    { status: 'running', at: iso },
                    { status: 'completed', at: iso },
                ],
            })
            const orgName = findOrg(schedule.orgSlug)?.name ?? schedule.orgSlug
            const bodies = digestBodies?.({ tenantSlug: schedule.tenantSlug, orgSlug: schedule.orgSlug }) ?? []
            const recent = bodies.slice(0, DIGEST_RECENT_LIMIT).map(digestSnippet)
            newEmails.push({
                id: `${worldNowMs}-${jobId.slice(0, 8)}`,
                to: digestRecipientEmail(schedule.orgSlug),
                subject: tEmail('digestSubject', { org: orgName }),
                at: iso,
                html: buildDigestEmailHtml(
                    {
                        heading: tEmail('digestHeading', { org: orgName }),
                        intro: tEmail('digestIntro', { org: orgName }),
                        countLine: tEmail('digestCount', { count: bodies.length }),
                        recentHeading: tEmail('digestRecentHeading'),
                        emptyLine: tEmail('digestEmpty'),
                        footer: tEmail('digestFooter'),
                    },
                    recent,
                ),
            })
        }
        setJobs((prev) => [...newJobs, ...prev])
        setEmails((prev) => [...newEmails, ...prev])
        return fired.length
    }

    // World-clock controls (twin of the real glue's clock handlers). Advance moves the offset forward
    // then drains due schedules at the new world "now"; run-due drains without moving; reset returns to
    // real time. worldNow is computed directly from the new offset (setState is async).
    function advanceClock(deltaMs: number) {
        const newOffset = clockOffsetMs + deltaMs
        setClockOffsetMs(newOffset)
        const spawned = runDueSchedules(mountedAtMs + newOffset)
        // Same tick drains due webhook deliveries — "advance past a retry's backoff and watch it fire"
        // works in the twin too. Silent (the Hooks tab shows the result); the notice stays
        // schedule-focused to match the real glue.
        runDueDeliveries(mountedAtMs + newOffset)
        pushNotice(
            spawned > 0 ? tSimulator('noticeScheduleFired', { count: spawned }) : tSimulator('noticeClockAdvanced'),
        )
    }

    function resetClock() {
        setClockOffsetMs(0)
        pushNotice(tSimulator('noticeClockReset'))
    }

    function runDueSchedulesNow() {
        const spawned = runDueSchedules(mountedAtMs + clockOffsetMs)
        pushNotice(spawned > 0 ? tSimulator('noticeScheduleFired', { count: spawned }) : tSimulator('noticeNoDue'))
    }

    // The actor drivers read/write jobs through the stable ref + setter, so these factories never need
    // to change identity — an actor's tick closure can be rebuilt freely without restarting its loop.
    const serviceDriver = useCallback(
        (scope: DemoServiceScope, log: ActorLog) => createDemoServiceDriver({ jobsRef, setJobs, log }, scope),
        [],
    )
    const builderDriver = useCallback(
        (serviceManagedOrgSlugs: readonly string[], log: ActorLog) =>
            createDemoBuilderDriver({ jobsRef, setJobs, log }, serviceManagedOrgSlugs),
        [],
    )

    // ── Inbound mail ──────────────────────────────────────────────────────────────────────────────

    /**
     * Twin of intakeInboundEmail (../inbound-email/intake.ts): the world emails the app. Parse the
     * recipient with the SAME pure core parser, resolve the org from the seed (org slugs are globally
     * unique), then dispatch to the registered handler twin — an unregistered slug lands an 'unmatched'
     * row, exactly like a missing entry in the real registry. Genuine parity (pure logic), no physics
     * degrade. Audit is written for the RESOLVED org/actor (not the signed-in viewpoint), so inbound
     * mail into a team you're not looking at is still attributed correctly.
     */
    function composeInbound(input: InboundComposeInput) {
        const to = formatInboundRecipient(input.orgSlug, input.handler, DEMO_INBOUND_DOMAIN)
        const parsed = parseInboundRecipient(to)
        const seedOrg = parsed ? organizations.find((o) => o.slug === parsed.orgSlug) : null
        if (!parsed || !seedOrg) {
            pushNotice(tSimulator('noticeInboundSent', { status: tSimulator('inboundStatus_unmatched') }))
            return
        }
        const fromEmail = normalizeEmailAddress(input.from) || input.from.trim().toLowerCase()
        const bodyText = normalizeInboundBody(input.body)
        const at = new Date().toISOString()
        const id = `inbound-${at}-${inbound.length}`

        let status = 'unmatched'
        let handlerClaimed: string | null = null
        let error: string | null = null
        let actor = INBOUND_SYSTEM_ACTOR

        const handler = inboundHandlers[parsed.handler]
        if (!handler) {
            error = `no handler: ${parsed.handler}`
        } else {
            handlerClaimed = parsed.handler
            const result = handler({
                org: seedOrg,
                members: allPeople.filter((p) => p.memberships.some((m) => m.orgSlug === seedOrg.slug)),
                fromEmail,
                subject: input.subject,
                bodyText,
                recordAudit: (entry) => appendAudit(entry, seedOrg.tenantSlug, seedOrg.slug, at),
            })
            if (result.status === 'handled') {
                status = 'handled'
                actor = result.actorUserId
            } else {
                error = result.reason
            }
        }

        setInbound((prev) => [
            {
                id,
                toEmail: normalizeEmailAddress(to) || to,
                fromEmail,
                subject: input.subject,
                status,
                handler: handlerClaimed,
                error,
                createdAt: at,
                tenantSlug: seedOrg.tenantSlug,
                orgSlug: seedOrg.slug,
            },
            ...prev,
        ])
        appendAudit(
            { action: 'inbound-email.received', subjectType: 'InboundEmail', subjectId: id, actorUserId: actor },
            seedOrg.tenantSlug,
            seedOrg.slug,
            at,
        )
        pushNotice(
            tSimulator('noticeInboundSent', {
                status: tSimulator(`inboundStatus_${status}` as 'inboundStatus_handled'),
            }),
        )
    }

    // ── Invites and membership ────────────────────────────────────────────────────────────────────

    /** Twin of POST /api/org/invite: refuse a duplicate address (the real API's 409), mint the invite,
     *  land its email in the catch-store, and notify the team's OTHER admins. */
    async function sendInvite({ email, role }: { email: string; role: string }) {
        setInviteError(null)
        // The same allowlist the real invite route enforces. The org screen only offers assignable
        // roles, so no click reaches this — but a tour script or other non-UI caller can pass 'admin'
        // straight in. The error is set before throwing because the org screen swallows the rejection
        // and shows only `inviteError`.
        if (!isAssignableRole(role)) {
            setInviteError(tOrg('inviteFailed'))
            throw new Error('role not assignable')
        }
        const taken = [...allPeople.map((p) => p.email), ...invites.map((i) => i.email)]
        if (taken.some((existing) => existing.toLowerCase() === email.toLowerCase())) {
            setInviteError(tOrg('inviteDuplicate'))
            throw new Error('duplicate')
        }
        // crypto.randomUUID keeps twin ids collision-free (and symmetric with the fake adapter) — a
        // length-based id could be reused after an accept shrinks the list, making a stale email link
        // accept the WRONG invite.
        const id = crypto.randomUUID()
        const html = buildInviteEmailHtml(
            {
                heading: tEmail('inviteHeading', { org: org.name }),
                body: tEmail('inviteBody', { inviter: name, org: org.name, role }),
                button: tEmail('inviteButton'),
                linkFallback: tEmail('inviteLinkFallback'),
            },
            `#/accept-invite/${id}`,
        )
        setInvites((prev) => [...prev, { id, email, role, orgSlug: org.slug }])
        setEmails((prev) => [
            {
                id: `email-${prev.length}`,
                to: email,
                subject: tEmail('inviteSubject', { org: org.name }),
                html,
                at: new Date().toISOString(),
            },
            ...prev,
        ])
        logEvent('org_invite_sent', { tenant: tenant.slug, org: org.slug, role })
        logAudit('membership.invited', 'Membership', id)
        // Notify the inviting team's OTHER admins (the invitee has no account yet, so they can't hold
        // an in-app row — see the decision log).
        notifyAdminsOf(activeOrgSlug, 'org.invited', { email, role, orgName: org.name }, person?.id)
        pushNotice(tSimulator('noticeNewMail', { email }))
    }

    /** Twin of the accept-invite route: mint the person, consume the invite, sign them in, and record
     *  clickwrap-on-join acceptance of the tenant's current agreements so they aren't immediately gated. */
    function acceptInvite(inviteId: string, acceptedName: string) {
        const invite = invites.find((i) => i.id === inviteId)
        if (!invite) return
        const joinTenant = findOrg(invite.orgSlug)?.tenantSlug ?? ''
        const newPerson: SeedPerson = {
            id: `person-invited-${invite.id.slice(0, 8)}`,
            name: acceptedName,
            email: invite.email,
            locale: 'en',
            tenantSlug: joinTenant,
            memberships: [{ orgSlug: invite.orgSlug, role: invite.role as PersonRole }],
            restricted: invite.role === 'restricted',
        }
        setDynamicPeople((prev) => [...prev, newPerson])
        setInvites((prev) => prev.filter((i) => i.id !== invite.id))
        setInvitedViewpoint(null)
        setPerson(newPerson)
        setActiveOrgSlug(invite.orgSlug)
        setAcceptances((prev) => [
            ...prev,
            ...agreements
                .filter((a) => a.tenantSlug === joinTenant)
                .map((a) => ({
                    agreementId: a.id,
                    userId: newPerson.id,
                    version: a.version,
                    acceptedAt: new Date().toISOString(),
                })),
        ])
        go('dashboard')
    }

    function signIn(personId: string) {
        const picked = allPeople.find((p) => p.id === personId)
        if (!picked) return
        setPerson(picked)
        setInvitedViewpoint(null)
        setActiveOrgSlug(picked.memberships[0].orgSlug)
        go('dashboard')
    }

    function signOut() {
        setPerson(null)
        setInvitedViewpoint(null)
        go('')
    }

    function saveProfile(values: { name: string }) {
        setDisplayName(values.name)
    }

    // ── The Simulator people, viewpoint and mail scoping ────────────────────────────────────────────

    // Keep the continuity map current on every route or org change for whoever's signed in.
    // A ref mutation, not state — this deliberately doesn't trigger a re-render.
    useEffect(() => {
        if (!person) return
        continuityMap.current.set(`person:${person.id}`, { route: route || 'dashboard', org: activeOrgSlug })
    }, [route, activeOrgSlug, person])

    useEffect(() => {
        // Mirrors the real app's PageViewTracker beacon (fire on every route change); the static
        // shell has no server to send it to, so it goes straight into the in-memory event log.
        // Deliberately keyed on `route` only — an org switch alone shouldn't log a page_view.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        logEvent('page_view', { tenant: tenant.slug, path: route || 'welcome' })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [route])

    const peopleRows: Person[] = [
        ...allPeople.map((p) => {
            const key = `person:${p.id}`
            const seenAt = mailSeenAt[key]
            return {
                key,
                name: p.name,
                email: p.email,
                role: p.memberships[0].role,
                orgs: p.memberships,
                tenantSlug: p.tenantSlug,
                status: 'active' as const,
                hasAccount: true as const,
                unreadMail: emails.filter((email) => email.to === p.email && (!seenAt || email.at > seenAt)).length,
            }
        }),
        ...invites.map((invite) => {
            const key = `invited:${invite.id}`
            const seenAt = mailSeenAt[key]
            return {
                key,
                name: null,
                email: invite.email,
                role: invite.role,
                orgs: [{ orgSlug: invite.orgSlug, role: invite.role }],
                tenantSlug: findOrg(invite.orgSlug)?.tenantSlug ?? '',
                status: 'invited' as const,
                hasAccount: false as const,
                unreadMail: emails.filter((email) => email.to === invite.email && (!seenAt || email.at > seenAt))
                    .length,
            }
        }),
    ]
    const viewpoint = person ? `person:${person.id}` : invitedViewpoint
    // Mirrors the real glue's derivation (simulator-glue.tsx): resolve the viewpoint's email from
    // the same people list the People tab renders, rather than re-deriving it a second way.
    const personEmail = peopleRows.find((p) => p.key === viewpoint)?.email ?? null
    const scopedEmails =
        mailScope === 'all' || !personEmail ? emails : emails.filter((email) => email.to === personEmail)

    function selectPerson(key: string) {
        if (key.startsWith('invited:')) {
            const inviteId = key.replace(/^invited:/, '')
            if (!invites.some((invite) => invite.id === inviteId)) return
            // Mirrors POST /api/simulator/viewpoint's invited: branch: a viewpoint change, not a
            // sign-in — the main pane goes to the signed-out welcome screen, the panel follows.
            setPerson(null)
            setInvitedViewpoint(key)
            go('')
            return
        }
        const personId = key.replace(/^person:/, '')
        const target = allPeople.find((p) => p.id === personId)
        if (!target) return
        const remembered = continuityMap.current.get(key)
        setPerson(target)
        setInvitedViewpoint(null)
        setActiveOrgSlug(remembered?.org ?? target.memberships[0].orgSlug)
        go(remembered?.route ?? 'dashboard')
    }

    function markMailSeen() {
        if (!viewpoint) return
        setMailSeenAt((prev) => ({ ...prev, [viewpoint]: new Date().toISOString() }))
    }

    function openMailLink(href: string) {
        // Mirrors the real glue's policy, translated to the shell's hash router — and like the
        // real glue, a link this shell won't follow gets a notice instead of a silent nothing.
        if (href.startsWith('#')) {
            go(href.replace(/^#\/?/, ''))
            return
        }
        pushNotice(tSimulator('noticeLinkUnusable', { href }))
    }

    function copyMailLink(href: string) {
        void navigator.clipboard
            .writeText(href)
            .then(() => pushNotice(tSimulator('noticeLinkCopied')))
            .catch(() => pushNotice(tSimulator('noticeLinkCopyFailed')))
    }

    function clearMail() {
        setEmails([])
        pushNotice(tSimulator('noticeMailCleared'))
    }

    /**
     * Twin of the real Snapshots reset (ADR-0006): the shell has no `.data/` filesystem to wipe, so
     * "reset the world" just means setting every piece of in-memory state back to its initial value and
     * navigating to the welcome route — no save/restore here, there's no server to snapshot against
     * (SnapshotsApp hides that half of the UI when `snapshots` is undefined). The composition root's own rows
     * go back through `onReset`, since this world can't see them.
     */
    function resetWorld() {
        setPerson(null)
        setActiveOrgSlug(DEFAULT_ACTIVE_ORG)
        setDisplayName(null)
        // Back to the SEEDED outbox, not an empty one — reset restores the world the app described.
        setEmails(seededMail(options.initialMail))
        setInvites([])
        setDynamicPeople([])
        setInvitedViewpoint(null)
        setEvents([])
        setAuditEntries([])
        setFlags(INITIAL_FLAGS)
        setJobs([])
        setInbound([])
        setEndpoints([])
        setDeliveries([])
        setFailingEndpoints(new Set())
        setNewWebhookSecret(null)
        setNotifications([])
        setSmsMessages([])
        setNotifPrefs({})
        setSchedules(makeSeedSchedules())
        setAgreements(makeSeedAgreements())
        setAcceptances(makeSeedAcceptances())
        setClockOffsetMs(0)
        setMailScope('person')
        setMailSeenAt({})
        continuityMap.current.clear()
        onReset?.()
        setNotices([])
        go('')
        pushNotice(tSimulator('noticeWorldReset'))
    }

    return {
        route,
        person,
        activeOrgSlug,
        setActiveOrgSlug,
        tenant,
        org,
        name,
        allPeople,
        // Orgs this person belongs to (drives the OrgSwitcher) — orgs never span tenants, so this
        // never crosses the person's own ambient site.
        orgsForActivePerson: person
            ? organizations.filter((o) => person.memberships.some((m) => m.orgSlug === o.slug))
            : [],
        roleInOrg,
        signIn,
        signOut,
        saveProfile,

        blockingAgreement,
        advisoryAgreements,
        acceptAgreement,

        logEvent,
        logAudit,
        pushNotice,

        enqueueWebhook,
        notifyAdminsOf,
        notifyMemberOf,

        jobs,
        jobCounts: {
            queued: jobs.filter((job) => job.status === 'queued').length,
            running: jobs.filter((job) => job.status === 'running').length,
            completed: jobs.filter((job) => job.status === 'completed').length,
        },
        startJob,
        serviceDriver,
        builderDriver,

        invites,
        inviteError,
        sendInvite,
        acceptInvite,

        notifications,
        notifPrefs,
        markNotificationsRead: () =>
            setNotifications((prev) =>
                prev.map((n) =>
                    n.recipientPersonId === person?.id && n.readAt === null
                        ? { ...n, readAt: new Date().toISOString() }
                        : n,
                ),
            ),
        toggleNotifPref: (kind, channel, enabled) => {
            const key = `${person?.id ?? ''}:${activeOrgSlug}`
            setNotifPrefs((prev) => {
                const rows = (prev[key] ?? []).filter((r) => !(r.kind === kind && r.channel === channel))
                return { ...prev, [key]: [...rows, { kind, channel, enabled }] }
            })
        },

        endpoints,
        newWebhookSecret,
        dismissNewWebhookSecret: () => setNewWebhookSecret(null),
        createEndpoint: ({ url, eventKinds }) => {
            const id = crypto.randomUUID()
            const secret = makeWebhookSecret()
            setEndpoints((prev) => [
                { id, tenantSlug: tenant.slug, orgSlug: activeOrgSlug, url, secret, eventKinds, enabled: true },
                ...prev,
            ])
            setNewWebhookSecret(secret)
            logAudit('webhook-endpoint.created', 'WebhookEndpoint', id)
        },
        toggleEndpoint: (id, enabled) => {
            setEndpoints((prev) => prev.map((e) => (e.id === id ? { ...e, enabled } : e)))
            logAudit(enabled ? 'webhook-endpoint.enabled' : 'webhook-endpoint.disabled', 'WebhookEndpoint', id)
        },
        deleteEndpoint: (id) => {
            setEndpoints((prev) => prev.filter((e) => e.id !== id))
            // Deliveries cascade with their endpoint (migration 0010's ON DELETE CASCADE).
            setDeliveries((prev) => prev.filter((d) => d.endpointId !== id))
            logAudit('webhook-endpoint.deleted', 'WebhookEndpoint', id)
        },

        agreements,
        acceptances,
        bumpAgreement,

        notices,
        people: peopleRows,
        viewpoint,
        personEmail,
        selectPerson,
        mail: {
            scoped: scopedEmails,
            scope: personEmail ? mailScope : 'all',
            setScope: setMailScope,
            allCount: emails.length,
            seenAt: viewpoint ? (mailSeenAt[viewpoint] ?? null) : null,
            markSeen: markMailSeen,
            openLink: openMailLink,
            copyLink: copyMailLink,
            clear: clearMail,
        },
        inbound,
        inboundDomain: DEMO_INBOUND_DOMAIN,
        inboundOrgs: organizations.map((o) => ({ slug: o.slug, name: o.name, tenantSlug: o.tenantSlug })),
        inboundHandlerSlugs: Object.keys(inboundHandlers),
        composeInbound,
        smsMessages,
        events,
        auditEntries,
        schedules,
        jobsHeld: flags['jobs-held'] ?? false,
        runPendingJobs,
        clock: {
            offsetMs: clockOffsetMs,
            worldNowIso: new Date(mountedAtMs + clockOffsetMs).toISOString(),
            advance: advanceClock,
            reset: resetClock,
            runDue: runDueSchedulesNow,
        },
        deliveries,
        failingEndpointIds: [...failingEndpoints],
        toggleEndpointFailure: (endpointId, failing) => {
            setFailingEndpoints((prev) => {
                const next = new Set(prev)
                if (failing) next.add(endpointId)
                else next.delete(endpointId)
                return next
            })
            pushNotice(failing ? tSimulator('noticeHookFailOn') : tSimulator('noticeHookFailOff'))
        },
        runDueDeliveriesNow: () => {
            const delivered = runDueDeliveries(mountedAtMs + clockOffsetMs)
            pushNotice(tSimulator('noticeHooksDelivered', { count: delivered }))
        },
        featureFlags: Object.keys(INITIAL_FLAGS).map((flag) => ({ flag, enabled: flags[flag] ?? false })),
        setFeatureFlag: (flag, enabled) => setFlags((prev) => ({ ...prev, [flag]: enabled })),
        demoBannerOn: flags['demo-banner'] ?? false,
        resetWorld,
    }
}
