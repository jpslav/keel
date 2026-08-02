'use client'

import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActorsApp, type ActorSlot } from 'keel/components/simulator/actors-app'
import { SimulatorPanel, type SimulatorExtraTab, type SimulatorNotice } from 'keel/components/simulator/simulator-panel'
import type { Person } from 'keel/components/simulator/people-app'
import type { ScrubResult } from 'keel/components/simulator/errors-app'
import type { AnalyticsEvent, AuditEntry } from 'keel/components/simulator/events-app'
import type { HookDeliveryRow, HookEndpointRow } from 'keel/components/simulator/hooks-app'
import type { InboundComposeInput, InboundEmailRow } from 'keel/components/simulator/inbound-app'
import type { ScheduleRowLike, WorldJobLike } from 'keel/components/simulator/jobs-app'
import type { MailItem } from 'keel/components/simulator/mail-app'
import type { SmsMessageRow } from 'keel/components/simulator/messages-app'
import type { FeatureFlag, Snapshot, SnapshotAgreement } from 'keel/components/simulator/snapshots-app'
import { useTours } from 'keel/demo-static/tour/use-tours'
import { actors } from '@app-config/actors'
import { tabs as appSimulatorTabs } from '@app-config/simulator'

interface Summary {
    viewpoint: string | null
    signedIn: boolean
    people: Person[]
}

interface MailResponse {
    emails: MailItem[]
    mailSeenAt: string | null
    allCount: number
}

interface MessagesResponse {
    messages: SmsMessageRow[]
}

interface InboundResponse {
    inbound: InboundEmailRow[]
    orgs: { slug: string; name: string; tenantSlug: string }[]
    people: { email: string; name: string }[]
    handlers: string[]
    domain: string
}

interface EventsResponse {
    events: AnalyticsEvent[]
    flags: FeatureFlag[]
}

interface AuditResponse {
    audit: AuditEntry[]
}

interface SnapshotsResponse {
    snapshots: Snapshot[]
}

interface AgreementsResponse {
    agreements: SnapshotAgreement[]
}

interface JobsResponse {
    jobs: WorldJobLike[]
    held: boolean
}

interface SchedulesResponse {
    schedules: ScheduleRowLike[]
    clockOffsetMs: number
    worldNow: string
}

interface HooksResponse {
    endpoints: HookEndpointRow[]
    deliveries: HookDeliveryRow[]
    failingEndpointIds: string[]
}

const EMPTY_SUMMARY: Summary = { viewpoint: null, signedIn: false, people: [] }
const EMPTY_MAIL: MailResponse = { emails: [], mailSeenAt: null, allCount: 0 }
const EMPTY_MESSAGES: MessagesResponse = { messages: [] }
const EMPTY_INBOUND: InboundResponse = { inbound: [], orgs: [], people: [], handlers: [], domain: '' }
const EMPTY_EVENTS: EventsResponse = { events: [], flags: [] }
const EMPTY_AUDIT: AuditResponse = { audit: [] }
const EMPTY_SNAPSHOTS: SnapshotsResponse = { snapshots: [] }
const EMPTY_AGREEMENTS: AgreementsResponse = { agreements: [] }
const EMPTY_JOBS: JobsResponse = { jobs: [], held: false }
const EMPTY_SCHEDULES: SchedulesResponse = { schedules: [], clockOffsetMs: 0, worldNow: new Date(0).toISOString() }
const EMPTY_HOOKS: HooksResponse = { endpoints: [], deliveries: [], failingEndpointIds: [] }
const EXPANDED_POLL_MS = 4_000
const COLLAPSED_POLL_MS = 15_000
const NOTICE_MS = 6_000
const MAIL_SCOPE_KEY = 'app-simulator-mail-scope'
// Set right before a reset/restore's hard reload so the next mount can confirm what happened —
// simulator-owned feedback (never an app toast), surviving exactly one navigation.
const POST_NOTICE_KEY = 'app-simulator-post-notice'

type SimulatorTab =
    'people' | 'mail' | 'messages' | 'events' | 'jobs' | 'hooks' | 'actors' | 'errors' | 'snapshots' | 'tours'

/**
 * Suppression gate: the actor iframes (/[locale]/simulator/actors/<actor>) render inside this same
 * [locale] layout, but they are self-contained process frames — the panel and its polling must NOT
 * mount inside them (no nested Simulator, no poll storm across N frames). A pathname check short-
 * circuits to just the children; the panel + all its hooks live in SimulatorGlueInner, mounted only
 * for real product pages, so rules-of-hooks stays intact.
 */
export function SimulatorGlue({ locale, children }: { locale: string; children: ReactNode }) {
    const pathname = usePathname()
    if (pathname?.includes('/simulator/actors/')) return <>{children}</>
    return <SimulatorGlueInner locale={locale}>{children}</SimulatorGlueInner>
}

/**
 * 'use client' glue (per header-glue.tsx): the layout is a Server Component that doesn't re-run
 * on client navigation, so this owns fetching Simulator's own data and supplies the navigation
 * callback — src/components stays router-agnostic. Mounted at src/app/[locale]/layout.tsx (via a
 * simulated-mode-only dynamic import) so it covers protected pages, signin, and welcome alike.
 */
function SimulatorGlueInner({ locale, children }: { locale: string; children: ReactNode }) {
    const t = useTranslations('simulator')
    // The app's own copy namespace, for things the panel renders but the framework does not name —
    // today, the registered actors' card titles.
    const tActors = useTranslations('actors')
    const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY)
    const [expanded, setExpanded] = useState(false)
    const [activeTab, setActiveTab] = useState<SimulatorTab>('people')
    const [mailScope, setMailScope] = useState<'person' | 'all'>('person')
    const [mail, setMail] = useState<MailResponse>(EMPTY_MAIL)
    const [inboundData, setInboundData] = useState<InboundResponse>(EMPTY_INBOUND)
    const [messagesData, setMessagesData] = useState<MessagesResponse>(EMPTY_MESSAGES)
    const [eventsData, setEventsData] = useState<EventsResponse>(EMPTY_EVENTS)
    const [auditData, setAuditData] = useState<AuditResponse>(EMPTY_AUDIT)
    const [snapshotsData, setSnapshotsData] = useState<SnapshotsResponse>(EMPTY_SNAPSHOTS)
    const [jobsData, setJobsData] = useState<JobsResponse>(EMPTY_JOBS)
    const [schedulesData, setSchedulesData] = useState<SchedulesResponse>(EMPTY_SCHEDULES)
    const [hooksData, setHooksData] = useState<HooksResponse>(EMPTY_HOOKS)
    const [snapshotsBusy, setSnapshotsBusy] = useState(false)
    const [busySnapshot, setBusySnapshot] = useState<string | null>(null)
    const [agreementsData, setAgreementsData] = useState<AgreementsResponse>(EMPTY_AGREEMENTS)
    const [busyAgreement, setBusyAgreement] = useState<string | null>(null)
    const [notices, setNotices] = useState<SimulatorNotice[]>([])
    const noticeSeq = useRef(0)
    const prevUnread = useRef<Map<string, number> | null>(null)
    // Scripted walkthroughs (@app-config/tours, read by the engine itself). The one snapshot this host
    // can put the world into for a tour is the same reset the Snapshots tab offers — and since that
    // reloads the page, the engine's resume marker is what carries the tour across it.
    const tours = useTours({
        onSnapshot: (snapshot) => {
            if (snapshot === 'reset') handleReset()
        },
    })

    const personEmail = summary.people.find((person) => person.key === summary.viewpoint)?.email ?? null
    // Signed-out (or no viewpoint yet) forces the "all mail" scope — there's no one's own inbox to show.
    const effectiveMailScope: 'person' | 'all' = personEmail ? mailScope : 'all'

    const pushNotice = useCallback((text: string) => {
        const id = (noticeSeq.current += 1)
        setNotices((prev) => [...prev, { id, text }])
        setTimeout(() => setNotices((prev) => prev.filter((notice) => notice.id !== id)), NOTICE_MS)
    }, [])

    const refresh = useCallback(async () => {
        const response = await fetch('/api/simulator/summary')
        if (!response.ok) return
        const next = (await response.json()) as Summary
        setSummary(next)
        // New-mail feedback, simulator-owned: the strip when expanded, the pill's pulsing badge
        // when collapsed (the panel handles that side). Skip the first load — nothing is "new".
        if (prevUnread.current) {
            for (const person of next.people) {
                const before = prevUnread.current.get(person.key) ?? 0
                if (person.unreadMail > before) pushNotice(t('noticeNewMail', { email: person.email }))
            }
        }
        prevUnread.current = new Map(next.people.map((person) => [person.key, person.unreadMail]))
    }, [pushNotice, t])

    const refreshMail = useCallback(async () => {
        const query = effectiveMailScope === 'all' ? 'all=1' : `person=${encodeURIComponent(summary.viewpoint ?? '')}`
        const response = await fetch(`/api/simulator/mail?${query}`)
        if (!response.ok) return
        setMail((await response.json()) as MailResponse)
    }, [effectiveMailScope, summary.viewpoint])

    const refreshInbound = useCallback(async () => {
        const response = await fetch('/api/simulator/inbound')
        if (!response.ok) return
        setInboundData((await response.json()) as InboundResponse)
    }, [])

    const refreshEvents = useCallback(async () => {
        const response = await fetch('/api/simulator/events')
        if (!response.ok) return
        setEventsData((await response.json()) as EventsResponse)
    }, [])

    // Audit rides the Events tab (it renders there, beneath the analytics events), so it's fetched
    // wherever events are — never on its own tab.
    const refreshAudit = useCallback(async () => {
        const response = await fetch('/api/simulator/audit')
        if (!response.ok) return
        setAuditData((await response.json()) as AuditResponse)
    }, [])

    const refreshSnapshots = useCallback(async () => {
        const response = await fetch('/api/simulator/snapshots')
        if (!response.ok) return
        setSnapshotsData((await response.json()) as SnapshotsResponse)
    }, [])

    const refreshAgreements = useCallback(async () => {
        const response = await fetch('/api/simulator/agreements')
        if (!response.ok) return
        setAgreementsData((await response.json()) as AgreementsResponse)
    }, [])

    const refreshJobs = useCallback(async () => {
        const response = await fetch('/api/simulator/jobs')
        if (!response.ok) return
        setJobsData((await response.json()) as JobsResponse)
    }, [])

    const refreshSchedules = useCallback(async () => {
        const response = await fetch('/api/simulator/schedules')
        if (!response.ok) return
        setSchedulesData((await response.json()) as SchedulesResponse)
    }, [])

    const refreshHooks = useCallback(async () => {
        const response = await fetch('/api/simulator/webhooks')
        if (!response.ok) return
        setHooksData((await response.json()) as HooksResponse)
    }, [])

    const refreshMessages = useCallback(async () => {
        const response = await fetch('/api/simulator/messages')
        if (!response.ok) return
        setMessagesData((await response.json()) as MessagesResponse)
    }, [])

    useEffect(() => {
        // Fetch-on-mount: refresh() eventually calls setSummary once the response lands, which is
        // the legitimate "sync with an external system" case the set-state-in-effect rule guards.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void refresh()
        // Restore the persisted mail scope, and surface the post-reset/restore confirmation left
        // behind by the pre-reload sessionStorage marker (see handleReset/handleRestoreSnapshot).
        const storedScope = window.localStorage.getItem(MAIL_SCOPE_KEY)
        if (storedScope === 'all' || storedScope === 'person') setMailScope(storedScope)
        const marker = window.sessionStorage.getItem(POST_NOTICE_KEY)
        if (marker) {
            window.sessionStorage.removeItem(POST_NOTICE_KEY)
            try {
                const parsed = JSON.parse(marker) as { kind: string; name?: string }
                if (parsed.kind === 'reset') pushNotice(t('noticeWorldReset'))
                if (parsed.kind === 'restore' && parsed.name) {
                    pushNotice(t('noticeSnapshotRestored', { name: parsed.name }))
                }
            } catch {
                // stale/garbled marker — nothing to confirm
            }
        }
        // Intentionally mount-only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        // SSE is wrong for flat files + a Lambda target (see plan); poll instead. The pill's
        // unread badge must stay live even while collapsed (carry-over from slice 1), just less
        // eagerly — mail/events content only matters while their tab is actually open.
        const id = setInterval(
            () => {
                void refresh()
                if (expanded && activeTab === 'mail') {
                    void refreshMail()
                    // Inbound email rides the Mail tab beside the outbound catch-store.
                    void refreshInbound()
                }
                // The SMS catch-store lives on the Messages tab.
                if (expanded && activeTab === 'messages') void refreshMessages()
                if (expanded && activeTab === 'events') {
                    void refreshEvents()
                    void refreshAudit()
                }
                // The Actors tab's world strip reads this SAME jobsData (see the `actors` prop
                // below) rather than polling its own copy, so it rides the Jobs tab's poll condition.
                if (expanded && (activeTab === 'jobs' || activeTab === 'actors')) void refreshJobs()
                // Schedules + world clock live on the Jobs tab.
                if (expanded && activeTab === 'jobs') void refreshSchedules()
                // Endpoints + deliveries live on the Hooks tab.
                if (expanded && activeTab === 'hooks') void refreshHooks()
            },
            expanded ? EXPANDED_POLL_MS : COLLAPSED_POLL_MS,
        )
        return () => clearInterval(id)
    }, [
        expanded,
        activeTab,
        refresh,
        refreshMail,
        refreshInbound,
        refreshMessages,
        refreshEvents,
        refreshAudit,
        refreshJobs,
        refreshSchedules,
        refreshHooks,
    ])

    useEffect(() => {
        // Fetch immediately when the Mail tab opens (or its scope changes) rather than waiting for
        // the next poll tick — same "sync with an external system" case as the mount effect above.
        if (expanded && activeTab === 'mail') {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            void refreshMail()
            void refreshInbound()
        }
    }, [expanded, activeTab, refreshMail, refreshInbound])

    useEffect(() => {
        // Fetch immediately when the Messages tab opens — the mail-tab precedent.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (expanded && activeTab === 'messages') void refreshMessages()
    }, [expanded, activeTab, refreshMessages])

    useEffect(() => {
        if (expanded && activeTab === 'events') {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            void refreshEvents()
            void refreshAudit()
        }
    }, [expanded, activeTab, refreshEvents, refreshAudit])

    useEffect(() => {
        // Same immediate-on-open treatment as Mail/Events above — and the Actors tab needs it too
        // (its world strip is jobsData, not a fetch of its own; opening it with no jobs tab visit
        // yet in this session must not show stale-empty counts).
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (expanded && (activeTab === 'jobs' || activeTab === 'actors')) void refreshJobs()

        if (expanded && activeTab === 'jobs') void refreshSchedules()

        if (expanded && activeTab === 'hooks') void refreshHooks()
    }, [expanded, activeTab, refreshJobs, refreshSchedules, refreshHooks])

    useEffect(() => {
        // Snapshots hosts the feature-flag knobs too, so it needs the events payload (flags ride on
        // it) alongside the snapshot list. No poll needed — reset/restore force a full reload.
        if (expanded && activeTab === 'snapshots') {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            void refreshSnapshots()
            void refreshEvents()
            void refreshAgreements()
        }
    }, [expanded, activeTab, refreshSnapshots, refreshEvents, refreshAgreements])

    function handleSelect(person: string) {
        void fetch('/api/simulator/viewpoint', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ person, locale }),
        }).then(async (response) => {
            if (!response.ok) return
            const json = (await response.json()) as { redirectTo: string }
            // A full reload is required anyway: theme + header are per-user RSC output.
            window.location.assign(json.redirectTo)
        })
    }

    function handleMailSeen() {
        if (!summary.viewpoint) return
        void fetch('/api/simulator/mail/seen', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ person: summary.viewpoint }),
        }).then((response) => {
            if (response.ok) void refresh()
        })
    }

    function handleScopeChange(scope: 'person' | 'all') {
        setMailScope(scope)
        window.localStorage.setItem(MAIL_SCOPE_KEY, scope)
    }

    function handleOpenMailLink(href: string) {
        // Same-origin only (design invariant) — but never silently: a link this glue won't follow
        // gets a notice saying why. A relative path covers twin-style links; real emails (e.g. the
        // invite accept link) carry a fully-qualified URL since they're read from an arbitrary
        // mail client, so a matching-origin absolute URL is allowed too. `//host/path` is
        // protocol-relative (cross-origin despite the leading slash) — it falls through to the
        // URL branch below, where the origin check judges it honestly.
        if (href.startsWith('/') && !href.startsWith('//')) {
            window.location.assign(href)
            return
        }
        try {
            const url = new URL(href)
            if (url.origin === window.location.origin) {
                window.location.assign(href)
                return
            }
            pushNotice(t('noticeLinkOrigin', { origin: url.origin }))
        } catch {
            pushNotice(t('noticeLinkUnusable', { href }))
        }
    }

    function handleCopyLink(href: string) {
        void navigator.clipboard
            .writeText(href)
            .then(() => pushNotice(t('noticeLinkCopied')))
            .catch(() => pushNotice(t('noticeLinkCopyFailed')))
    }

    function handleClearMail() {
        void fetch('/api/simulator/mail/clear', { method: 'POST' }).then((response) => {
            if (!response.ok) return
            void refreshMail()
            void refresh()
            pushNotice(t('noticeMailCleared'))
        })
    }

    function handleComposeInbound(input: InboundComposeInput) {
        void fetch('/api/simulator/inbound/compose', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input),
        }).then(async (response) => {
            if (!response.ok) return
            const { outcome } = (await response.json()) as { outcome: { status: string } }
            // Refresh the inbound list (the new row) AND the mail/summary (a handled ticket may have
            // fired a notification email into an inbox). Feedback stays inside Simulator.
            await Promise.all([refreshInbound(), refresh()])
            pushNotice(
                t('noticeInboundSent', { status: t(`inboundStatus_${outcome.status}` as 'inboundStatus_handled') }),
            )
        })
    }

    function handleToggleFlag(flag: string, enabled: boolean) {
        void fetch('/api/simulator/flags', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ flag, enabled }),
        }).then((response) => {
            // Full reload: the demo banner is rendered by the protected layout (an RSC) and only
            // re-reads the flag on a fresh request (see docs/build-notes.md on glue-triggered reloads).
            if (response.ok) window.location.reload()
        })
    }

    function handleServerErrorScenario(): Promise<ScrubResult> {
        return fetch('/api/simulator/error-scenario').then((response) => response.json() as Promise<ScrubResult>)
    }

    function handleRunPending() {
        void fetch('/api/simulator/jobs/run-pending', { method: 'POST' }).then(async (response) => {
            if (!response.ok) return
            const { ran } = (await response.json()) as { ran: number }
            await refreshJobs()
            // Feedback stays inside Simulator (never an app toast) — same channel as mail/snapshots.
            pushNotice(t('noticeJobsRan', { count: ran }))
        })
    }

    // After any clock/run-due action, refresh both the schedule view (offset + next runs moved) and
    // the jobs list (a fired schedule spawned + completed a job inline), then confirm inside Simulator.
    async function afterSchedulesChanged(spawned: number, moved: 'advanced' | 'reset' | null) {
        await Promise.all([refreshSchedules(), refreshJobs(), refresh()])
        if (spawned > 0) pushNotice(t('noticeScheduleFired', { count: spawned }))
        else if (moved === 'advanced') pushNotice(t('noticeClockAdvanced'))
        else if (moved === 'reset') pushNotice(t('noticeClockReset'))
        else pushNotice(t('noticeNoDue'))
    }

    async function handleAdvanceClock(deltaMs: number) {
        const response = await fetch('/api/simulator/clock', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'advance', deltaMs }),
        })
        if (!response.ok) return
        const { spawned } = (await response.json()) as { spawned: number }
        await afterSchedulesChanged(spawned, 'advanced')
    }

    async function handleResetClock() {
        const response = await fetch('/api/simulator/clock', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'reset' }),
        })
        if (!response.ok) return
        await afterSchedulesChanged(0, 'reset')
    }

    async function handleRunDue() {
        const response = await fetch('/api/simulator/schedules/run-due', { method: 'POST' })
        if (!response.ok) return
        const { spawned } = (await response.json()) as { spawned: number }
        await afterSchedulesChanged(spawned, null)
    }

    async function handleToggleFail(endpointId: string, failing: boolean) {
        const response = await fetch('/api/simulator/webhooks/fail', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ endpointId, failing }),
        })
        if (response.ok) {
            await refreshHooks()
            pushNotice(failing ? t('noticeHookFailOn') : t('noticeHookFailOff'))
        }
    }

    async function handleRunDueDeliveries() {
        const response = await fetch('/api/simulator/webhooks/run-due', { method: 'POST' })
        if (!response.ok) return
        const { deliveries } = (await response.json()) as { deliveries: { delivered: number } }
        await refreshHooks()
        pushNotice(t('noticeHooksDelivered', { count: deliveries.delivered }))
    }

    function handleLocaleChange(next: string) {
        if (next === locale) return
        // Swap the leading /<locale> segment and full-reload the same page — mirrors profile-glue's
        // locale save (theme + header are per-request RSC output, so a soft nav wouldn't re-render
        // them). The regex only touches the first segment, preserving the rest of the path.
        const { pathname, search, hash } = window.location
        const nextPath = pathname.replace(new RegExp(`^/${locale}(?=/|$)`), `/${next}`)
        window.location.assign(nextPath + search + hash)
    }

    function handleReset() {
        setSnapshotsBusy(true)
        void fetch('/api/simulator/reset', { method: 'POST' }).then((response) => {
            if (response.ok) {
                window.sessionStorage.setItem(POST_NOTICE_KEY, JSON.stringify({ kind: 'reset' }))
                // Hard reload of a wiped world (per design invariant) — no point resetting
                // snapshotsBusy, this tab is about to be torn down along with everything else.
                window.location.assign(`/${locale}`)
                return
            }
            setSnapshotsBusy(false)
        })
    }

    function handleSaveSnapshot(name: string) {
        setSnapshotsBusy(true)
        void fetch('/api/simulator/snapshots', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name }),
        }).then((response) => {
            setSnapshotsBusy(false)
            if (response.ok) {
                pushNotice(t('noticeSnapshotSaved', { name }))
                void refreshSnapshots()
            }
        })
    }

    function handleRestoreSnapshot(name: string) {
        setBusySnapshot(name)
        void fetch('/api/simulator/snapshots/restore', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name }),
        }).then((response) => {
            if (response.ok) {
                window.sessionStorage.setItem(POST_NOTICE_KEY, JSON.stringify({ kind: 'restore', name }))
                window.location.assign(`/${locale}`)
                return
            }
            setBusySnapshot(null)
        })
    }

    function handleDeleteSnapshot(name: string) {
        setBusySnapshot(name)
        void fetch('/api/simulator/snapshots/delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name }),
        }).then((response) => {
            setBusySnapshot(null)
            if (response.ok) {
                pushNotice(t('noticeSnapshotDeleted', { name }))
                void refreshSnapshots()
            }
        })
    }

    // Bump one agreement's version — the access-gate demo story. Re-arms the gate for everyone
    // whose latest acceptance is now stale; the next protected navigation shows the interstitial.
    function handleBumpAgreement(id: string) {
        setBusyAgreement(id)
        void fetch('/api/simulator/agreements/bump', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ agreementId: id }),
        }).then(async (response) => {
            setBusyAgreement(null)
            if (!response.ok) return
            const { version } = (await response.json()) as { version: number }
            pushNotice(t('noticeAgreementBumped', { version }))
            void refreshAgreements()
        })
    }

    // The actor frames are our own same-origin pages (src/app/[locale]/simulator/actors/[actor]) —
    // the locale segment is all they need; SimulatorGlue's own pathname suppression (above) keeps
    // the panel from mounting inside them, so there's no postMessage bridge to wire here (unlike
    // mail-app.tsx's link bridge for its opaque-origin reading pane).
    const actorSlots: ActorSlot[] = useMemo(
        () =>
            actors.map((actor) => ({
                id: actor.id,
                // The panel is handed FINISHED strings: a counterparty an app invents is app
                // vocabulary, so its copy lives in the app catalog's `actors` namespace.
                title: tActors(actor.titleKey),
                description: tActors(actor.descriptionKey),
                iframeSrc: `/${locale}/simulator/actors/${actor.id}`,
            })),
        [locale, tActors],
    )
    const actorCounts = useMemo(
        () => ({
            queued: jobsData.jobs.filter((job) => job.status === 'queued').length,
            running: jobsData.jobs.filter((job) => job.status === 'running').length,
            completed: jobsData.jobs.filter((job) => job.status === 'completed').length,
        }),
        [jobsData.jobs],
    )

    // The app's Simulator tabs (Actors today) — registered on the seam (@app-config/simulator) so the
    // panel stays app-blind; composed here with the cross-tenant job data this glue already polls, and
    // slotted by the panel between Hooks and Errors. Content is app-owned and host-built (ADR-0006);
    // Actors is the only app tab today, so a second would branch on tab.id below.
    const extraTabs: SimulatorExtraTab[] = useMemo(
        () =>
            appSimulatorTabs.map((tab) => ({
                id: tab.id,
                label: t(tab.labelKey),
                content: <ActorsApp slots={actorSlots} world={{ held: jobsData.held, counts: actorCounts }} />,
            })),
        [t, actorSlots, jobsData.held, actorCounts],
    )

    return (
        <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'stretch' }}>
            <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
            <SimulatorPanel
                people={summary.people}
                viewpoint={summary.viewpoint}
                signedIn={summary.signedIn}
                onSelect={handleSelect}
                onRefresh={refresh}
                onExpandedChange={(value) => {
                    setExpanded(value)
                    if (value) void refresh()
                }}
                onTabChange={(tab) => setActiveTab(tab as SimulatorTab)}
                onLocaleChange={handleLocaleChange}
                notices={notices}
                mail={{
                    emails: mail.emails,
                    scope: effectiveMailScope,
                    onScopeChange: handleScopeChange,
                    personEmail,
                    mailSeenAt: mail.mailSeenAt,
                    allCount: mail.allCount,
                    onOpenLink: handleOpenMailLink,
                    onSeen: handleMailSeen,
                    onClear: handleClearMail,
                    onCopyLink: handleCopyLink,
                }}
                inbound={{
                    inbound: inboundData.inbound,
                    orgs: inboundData.orgs,
                    people: inboundData.people,
                    handlers: inboundData.handlers,
                    domain: inboundData.domain,
                    onCompose: handleComposeInbound,
                }}
                messages={messagesData.messages}
                events={eventsData.events}
                audit={auditData.audit}
                jobs={{
                    jobs: jobsData.jobs,
                    held: jobsData.held,
                    onRunPending: handleRunPending,
                    schedules: schedulesData.schedules,
                    clock: {
                        offsetMs: schedulesData.clockOffsetMs,
                        worldNow: schedulesData.worldNow,
                        onAdvance: handleAdvanceClock,
                        onReset: handleResetClock,
                        onRunDue: handleRunDue,
                    },
                }}
                hooks={{
                    endpoints: hooksData.endpoints,
                    deliveries: hooksData.deliveries,
                    failingEndpointIds: hooksData.failingEndpointIds,
                    onToggleFail: handleToggleFail,
                    onRunDue: handleRunDueDeliveries,
                }}
                extraTabs={extraTabs}
                runServerErrorScenario={handleServerErrorScenario}
                snapshots={{
                    snapshots: snapshotsData.snapshots,
                    onReset: handleReset,
                    onSave: handleSaveSnapshot,
                    onRestore: handleRestoreSnapshot,
                    onDelete: handleDeleteSnapshot,
                    busy: snapshotsBusy,
                    busySnapshot,
                    flags: eventsData.flags,
                    onToggleFlag: handleToggleFlag,
                    agreements: agreementsData.agreements,
                    onBumpAgreement: handleBumpAgreement,
                    busyAgreement,
                }}
                tours={tours.tab}
            />
            {tours.overlay}
        </div>
    )
}
