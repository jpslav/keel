'use client'

import { Box, Group, SegmentedControl, Stack, Text, UnstyledButton } from '@mantine/core'
import { useLocale, useTranslations } from 'next-intl'
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
// LOCALES is imported relatively (not via '@') so the static-demo vite bundle resolves it the
// same way it resolves the rest of this component tree.
import { LOCALES } from '../../core/locale'
import { PeopleApp, chipStyle, type Person } from './people-app'
import { ErrorsApp, type ScrubResult } from './errors-app'
import { type AuditEntry, EventsApp, type AnalyticsEvent } from './events-app'
import { HooksApp, type HookDeliveryRow, type HookEndpointRow } from './hooks-app'
import { InboundApp, type InboundAppProps } from './inbound-app'
import { JobsApp, type ScheduleRowLike, type WorldClockLike, type WorldJobLike } from './jobs-app'
import { MailApp, type MailItem } from './mail-app'
import { MessagesApp, type SmsMessageRow } from './messages-app'
import { ToursApp, type ToursAppProps } from './tours-app'
import { tabMount } from './tab-mount'
import { SnapshotsApp, type FeatureFlag, type Snapshot, type SnapshotAgreement } from './snapshots-app'

const COLLAPSED_KEY = 'app-simulator-collapsed'
const WIDTH_KEY = 'app-simulator-width'
const TAB_KEY = 'app-simulator-tab'
const COACH_KEY = 'app-simulator-coach-dismissed'

// The panel's OWN (framework) tabs — one per subsystem. App tabs arrive via `extraTabs` and slot in
// between Hooks and Errors; the active tab is therefore a plain string (a core id OR an extra id).
type SimulatorTab = 'people' | 'mail' | 'messages' | 'events' | 'jobs' | 'hooks' | 'errors' | 'snapshots' | 'tours'
const CORE_TAB_IDS: SimulatorTab[] = [
    'people',
    'mail',
    'messages',
    'events',
    'jobs',
    'hooks',
    'errors',
    'snapshots',
    'tours',
]

/** One app-registered tab, composed by the host (label already translated, content already built). */
export interface SimulatorExtraTab {
    id: string
    label: string
    content: ReactNode
    /** Mount the content from page load and never unmount it — shown when its tab is, hidden otherwise
     *  (other tabs, panel collapsed) — for content that RUNS something, like the Actors tab's tick
     *  loops. Unset: the content exists only while its tab is showing. See ./tab-mount. */
    keepMounted?: boolean
}

// Panel width is a continuous drag (the seam on the panel's left edge), clamped to this range;
// the extra `viewport - 360` clamp keeps at least that much room for the main pane.
const MIN_WIDTH = 300
const MAX_WIDTH = 720
const DEFAULT_WIDTH = 360
const WIDTH_STEP = 16

function clampWidth(value: number): number {
    const viewportCap = typeof window === 'undefined' ? MAX_WIDTH : Math.min(MAX_WIDTH, window.innerWidth - 360)
    // Never let the viewport cap push the ceiling below the floor (very narrow screens).
    const max = Math.max(MIN_WIDTH, viewportCap)
    return Math.min(Math.max(value, MIN_WIDTH), max)
}

// Errors is the technical proof screen — it assumes a light page background, so wrap ONLY its tab
// content in a light box rather than reskin it. (Events now carries its own dark skin instead.)
const lightBoxStyle: CSSProperties = { background: '#f8f9fa', color: '#1a1b1e', borderRadius: 8 }

function readStoredCollapsed(): boolean {
    if (typeof window === 'undefined') return true
    const raw = window.localStorage.getItem(COLLAPSED_KEY)
    return raw === null ? true : raw === 'true'
}

function readStoredWidth(): number {
    if (typeof window === 'undefined') return DEFAULT_WIDTH
    // parseInt honours legacy preset values ('360'/'520') as plain numbers; NaN → default.
    const parsed = Number.parseInt(window.localStorage.getItem(WIDTH_KEY) ?? '', 10)
    return Number.isNaN(parsed) ? DEFAULT_WIDTH : clampWidth(parsed)
}

// Validated against core ∪ extra ids (the host's registered tabs) so a persisted app tab survives a
// reload; anything unknown falls back to 'people'.
function readStoredTab(validIds: string[]): string {
    if (typeof window === 'undefined') return 'people'
    const raw = window.localStorage.getItem(TAB_KEY)
    return raw !== null && validIds.includes(raw) ? raw : 'people'
}

function readCoachDismissed(): boolean {
    if (typeof window === 'undefined') return true
    return window.localStorage.getItem(COACH_KEY) === 'true'
}

/** A transient, simulator-owned notification (never the app's real estate — see decision log). */
export interface SimulatorNotice {
    id: number
    text: string
}

export interface MailAppProps {
    emails: MailItem[]
    scope: 'person' | 'all'
    onScopeChange: (scope: 'person' | 'all') => void
    personEmail: string | null
    mailSeenAt?: string | null
    /** Total messages across every inbox — powers the "N in All mail" hint in person scope. */
    allCount?: number
    onOpenLink: (href: string) => void
    onSeen: () => void
    onClear?: () => void
    onCopyLink?: (href: string) => void
}

export interface SnapshotsAppProps {
    snapshots?: Snapshot[]
    onReset: () => void
    onSave?: (name: string) => void
    onRestore?: (name: string) => void
    onDelete?: (name: string) => void
    busy?: boolean
    busySnapshot?: string | null
    flags?: FeatureFlag[]
    onToggleFlag?: (flag: string, enabled: boolean) => void
    agreements?: SnapshotAgreement[]
    onBumpAgreement?: (id: string) => void
    busyAgreement?: string | null
}

export interface JobsAppProps {
    jobs: WorldJobLike[]
    held: boolean
    onRunPending?: () => void | Promise<void>
    /** Scheduled work — the world's schedules and clock control, both wired by the host. */
    schedules?: ScheduleRowLike[]
    clock?: WorldClockLike
}

export interface HooksAppProps {
    endpoints: HookEndpointRow[]
    deliveries: HookDeliveryRow[]
    failingEndpointIds: string[]
    onToggleFail: (endpointId: string, failing: boolean) => void | Promise<void>
    onRunDue: () => void | Promise<void>
}

/**
 * The Simulator panel (ADR-0006 twin lives in keel/demo-static): collapsed = a small fixed pill (no
 * layout shift); expanded = a right-docked column with its own dark skin so it reads as "not the
 * product". The column is sticky so it stays docked while long pages scroll. Router-agnostic —
 * navigation happens via `onSelect`/mail's `onOpenLink`, data arrives as props; the glue
 * (src/app/[locale]/simulator-glue.tsx) owns fetching and polling. Tab strip:
 * People / Mail / Messages / Events / Jobs / Hooks / …host `extraTabs`… / Errors / Snapshots / Tours —
 * `data-testid="simulator-tab-<id>"`. App tabs are registered on the seam (@app-config/simulator)
 * and composed by the host into `extraTabs`, slotted in between Hooks and Errors so the panel itself
 * knows nothing of app content. Transient
 * feedback stays inside simulator: a notice overlay anchored at the panel's bottom edge when
 * expanded (absolute, so it never shifts the scroll body), a pulsing unread badge on the pill when
 * collapsed — never app-level toasts that could collide with future product ones. The header shows
 * a locale switcher (host-driven, optional) and a chip naming the current viewpoint.
 */
export function SimulatorPanel({
    people,
    viewpoint,
    signedIn,
    onSelect,
    onRefresh,
    onExpandedChange,
    onTabChange,
    onLocaleChange,
    mail,
    inbound,
    messages,
    events,
    audit,
    jobs,
    hooks,
    extraTabs,
    runServerErrorScenario,
    snapshots,
    tours,
    notices = [],
}: {
    people: Person[]
    viewpoint: string | null
    signedIn: boolean
    onSelect: (key: string) => void
    onRefresh?: () => void
    onExpandedChange?: (expanded: boolean) => void
    /** Emits a core id OR an extra-tab id (a plain string) — the host narrows it if it cares. */
    onTabChange?: (tab: string) => void
    /** When provided, the header shows a locale switcher — the host owns what switching does (a
     *  full reload in the real app, in-memory state in the static demo). */
    onLocaleChange?: (locale: string) => void
    mail: MailAppProps
    /** Inbound email: the Mail tab's "compose inbound" affordance + world inbound list. */
    inbound: InboundAppProps
    messages: SmsMessageRow[]
    events: AnalyticsEvent[]
    /** Compliance-grade audit trail, rendered read-only beneath the analytics events. */
    audit: AuditEntry[]
    jobs: JobsAppProps
    hooks: HooksAppProps
    /** App-registered tabs (@app-config/simulator), composed by the host. Rendered between Hooks and
     *  Errors — visual order and the `simulator-tab-<id>` testid derive from each tab's id. */
    extraTabs: SimulatorExtraTab[]
    runServerErrorScenario: () => Promise<ScrubResult>
    snapshots: SnapshotsAppProps
    /** Scripted walkthroughs (keel/demo-static/tour/use-tours). Undefined when the app registers no
     *  tours — the tab then doesn't exist at all, which is the off-switch an adopter gets for free. */
    tours?: ToursAppProps
    notices?: SimulatorNotice[]
}) {
    const t = useTranslations('simulator')
    const locale = useLocale()
    // Collapsed by default: SSR has no localStorage, so starting expanded would flash the column
    // before the persisted value can be read on mount.
    const [collapsed, setCollapsed] = useState(true)
    const [width, setWidth] = useState<number>(DEFAULT_WIDTH)
    const [activeTab, setActiveTab] = useState<string>('people')
    const [coachDismissed, setCoachDismissed] = useState(true)
    // Drag/hover/focus state for the resize seam. dragRef stashes the pointer-down anchor so a
    // move recomputes width relative to where the drag started (not the last frame).
    const [dragging, setDragging] = useState(false)
    const [seamActive, setSeamActive] = useState(false)
    const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
    // Stamped as data-hydrated on the pill/panel root once this mount effect has run — i.e. once
    // React has attached the click handlers. The SSR'd pill LOOKS clickable before hydration but
    // silently swallows clicks; Playwright waits for the stamp instead of racing that window.
    const [hydrated, setHydrated] = useState(false)
    // Kept-mounted content (actor frames) mounts only once the host page has loaded — see ./tab-mount.
    const [pageLoaded, setPageLoaded] = useState(false)
    useEffect(() => {
        if (document.readyState === 'complete') {
            // Syncing with an external event (the window's load), so setting state here is the point.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setPageLoaded(true)
            return
        }
        const onLoad = () => setPageLoaded(true)
        window.addEventListener('load', onLoad, { once: true })
        return () => window.removeEventListener('load', onLoad)
    }, [])
    const mountState = { activeTab, collapsed, pageLoaded }
    // A kept-mounted tab hidden behind the collapsed pill still needs its panel in the DOM, at the
    // SAME tree position it had while expanded — an iframe that moves is an iframe that reloads.
    const keepPanel = !collapsed || extraTabs.some((tab) => tabMount(tab, mountState) === 'hidden')
    // A core tab's content shows only in an expanded panel (the hidden kept-alive panel holds nothing else).
    const showing = (tab: string) => !collapsed && activeTab === tab

    const totalUnread = people.reduce((sum, person) => sum + person.unreadMail, 0)
    const badgeRef = useRef<HTMLDivElement | null>(null)
    const prevUnread = useRef(totalUnread)

    useEffect(() => {
        // Reading localStorage is an external-system sync (SSR has none), so this legitimately
        // sets state from an effect rather than during render.
        const storedCollapsed = readStoredCollapsed()
        // Core ids ∪ the host's extra-tab ids — a persisted app tab must survive reload.
        const storedTab = readStoredTab([...CORE_TAB_IDS, ...extraTabs.map((tab) => tab.id)])
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCollapsed(storedCollapsed)
        setWidth(readStoredWidth())
        setActiveTab(storedTab)
        setCoachDismissed(readCoachDismissed())
        setHydrated(true)
        onExpandedChange?.(!storedCollapsed)
        onTabChange?.(storedTab)
        // Intentionally mount-only: syncs the caller's poll loop with the persisted state once.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        // Unmount-mid-drag safety net: pointerdown disables text selection on <body> and pointerup
        // restores it, but if the panel ever unmounts between the two the restore must still run.
        return () => {
            document.body.style.userSelect = ''
        }
    }, [])

    useEffect(() => {
        // Collapsed feedback channel: when new mail lands, the pill's badge pulses (Web Animations
        // API — no global CSS). Expanded feedback goes through the notice strip instead.
        if (totalUnread > prevUnread.current && collapsed) {
            badgeRef.current?.animate(
                [{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }],
                { duration: 500, iterations: 3 },
            )
        }
        prevUnread.current = totalUnread
    }, [totalUnread, collapsed])

    function dismissCoach() {
        setCoachDismissed(true)
        window.localStorage.setItem(COACH_KEY, 'true')
    }

    function toggle() {
        const next = !collapsed
        setCollapsed(next)
        window.localStorage.setItem(COLLAPSED_KEY, String(next))
        if (!coachDismissed) dismissCoach()
        onExpandedChange?.(!next)
        if (!next) onRefresh?.()
    }

    function persistWidth(next: number) {
        window.localStorage.setItem(WIDTH_KEY, String(next))
    }

    function onSeamPointerDown(event: PointerEvent<HTMLDivElement>) {
        // preventDefault stops the browser's own text-selection/drag; pointer capture keeps events
        // coming to the seam even as the cursor crosses the mail iframe (the primary drag fix).
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        dragRef.current = { startX: event.clientX, startWidth: width }
        document.body.style.userSelect = 'none'
        setDragging(true)
    }

    function onSeamPointerMove(event: PointerEvent<HTMLDivElement>) {
        if (!dragRef.current) return
        const { startX, startWidth } = dragRef.current
        // The seam is on the panel's LEFT edge, so moving left (smaller clientX) widens the panel.
        setWidth(clampWidth(startWidth + (startX - event.clientX)))
    }

    function endSeamDrag(event: PointerEvent<HTMLDivElement>) {
        if (!dragRef.current) return
        dragRef.current = null
        document.body.style.userSelect = ''
        setDragging(false)
        try {
            event.currentTarget.releasePointerCapture(event.pointerId)
        } catch {
            // capture may already be gone (pointercancel) — nothing to release.
        }
        // Persist the latest committed width without a stale closure over `width`.
        setWidth((current) => {
            persistWidth(current)
            return current
        })
    }

    function onSeamKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        let next: number | null = null
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = width + WIDTH_STEP
        else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = width - WIDTH_STEP
        else if (event.key === 'Home') next = MIN_WIDTH
        else if (event.key === 'End') next = MAX_WIDTH
        if (next === null) return
        event.preventDefault()
        const clamped = clampWidth(next)
        setWidth(clamped)
        persistWidth(clamped)
    }

    function resetWidth() {
        setWidth(DEFAULT_WIDTH)
        persistWidth(DEFAULT_WIDTH)
    }

    function selectTab(tab: string) {
        setActiveTab(tab)
        window.localStorage.setItem(TAB_KEY, tab)
        onTabChange?.(tab)
    }

    const pill = collapsed ? (
        <>
            {hydrated && !coachDismissed ? (
                <Box
                    component="aside"
                    aria-label={t('pillLabel')}
                    data-testid="simulator-coachmark"
                    style={{
                        position: 'fixed',
                        bottom: 132,
                        right: 16,
                        zIndex: 1000,
                        maxWidth: 250,
                        background: '#1a1b1e',
                        color: '#f8f9fa',
                        border: '1px solid #373a40',
                        borderRadius: 10,
                        padding: '10px 12px',
                        boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
                        // Visual-only: the bubble floats over app content, so it must never
                        // swallow the app's clicks — only the dismiss button is interactive
                        // (and opening the pill dismisses it too).
                        pointerEvents: 'none',
                    }}
                >
                    <Group justify="space-between" wrap="nowrap" align="start" gap="xs">
                        <Text size="xs" c="gray.2">
                            {t('coachmark')}
                        </Text>
                        <UnstyledButton
                            aria-label={t('coachmarkDismissAriaLabel')}
                            data-testid="simulator-coachmark-dismiss"
                            onClick={dismissCoach}
                            style={{
                                color: '#f8f9fa',
                                fontSize: 12,
                                fontWeight: 700,
                                lineHeight: 1,
                                pointerEvents: 'auto',
                            }}
                        >
                            {t('coachmarkDismiss')}
                        </UnstyledButton>
                    </Group>
                </Box>
            ) : null}
            <UnstyledButton
                data-testid="simulator-pill"
                data-hydrated={hydrated ? 'true' : undefined}
                aria-label={t('pillAriaLabel')}
                onClick={toggle}
                style={{
                    position: 'fixed',
                    bottom: 76,
                    right: 16,
                    zIndex: 1000,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: '#1a1b1e',
                    color: '#f8f9fa',
                    borderRadius: 999,
                    padding: '10px 18px',
                    border: '1px solid #373a40',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
                }}
            >
                <Text size="sm" fw={600} c="gray.0">
                    {t('pillLabel')}
                </Text>
                {totalUnread > 0 ? (
                    <Text
                        ref={badgeRef}
                        size="xs"
                        fw={700}
                        style={{ background: '#c92a2a', color: '#fff', borderRadius: 999, padding: '1px 8px' }}
                    >
                        {totalUnread}
                    </Text>
                ) : null}
            </UnstyledButton>
        </>
    ) : null

    // Host `extraTabs` slot in between Hooks and Errors — where Actors sat when it was hard-coded — so
    // visual order and the `simulator-tab-<id>` testids are preserved as app tabs register.
    const tabs: { id: string; label: string }[] = [
        { id: 'people', label: t('peopleTab') },
        { id: 'mail', label: t('mailTab') },
        { id: 'messages', label: t('messagesTab') },
        { id: 'events', label: t('eventsTab') },
        { id: 'jobs', label: t('jobsTab') },
        { id: 'hooks', label: t('hooksTab') },
        ...extraTabs.map((tab) => ({ id: tab.id, label: tab.label })),
        { id: 'errors', label: t('errorsTab') },
        { id: 'snapshots', label: t('snapshotsTab') },
        // Tours sits beside Snapshots (state and narrative, in that order) and only when the app has any.
        ...(tours ? [{ id: 'tours', label: t('toursTab') }] : []),
    ]

    // The person the panel is currently "watching" — powers the header chip so it's always clear
    // whose world this is, even before switching tabs.
    const person = people.find((person) => person.key === viewpoint) ?? null

    const panel = keepPanel ? (
        <Box
            component="aside"
            aria-label={t('panelTitle')}
            data-testid="simulator-panel"
            data-hydrated={hydrated ? 'true' : undefined}
            style={{
                width,
                flexShrink: 0,
                // Sticky so the panel stays docked while a long main pane scrolls (the inner
                // content box below is the scroll container for the panel's own overflow). Sticky
                // is a positioned value, so the absolute resize seam anchors to this box.
                position: 'sticky',
                top: 0,
                height: '100vh',
                alignSelf: 'flex-start',
                display: collapsed ? 'none' : 'flex',
                flexDirection: 'column',
                background: '#1a1b1e',
                color: '#f8f9fa',
                borderLeft: '1px solid #373a40',
            }}
        >
            {/* Draggable resize seam on the panel's left edge — a focusable separator so keyboard
                users can size the panel too (arrows step, Home/End jump, double-click resets). */}
            <Box
                role="separator"
                tabIndex={0}
                aria-orientation="vertical"
                aria-label={t('widthLabel')}
                aria-valuenow={width}
                aria-valuemin={MIN_WIDTH}
                aria-valuemax={MAX_WIDTH}
                data-testid="simulator-resize"
                onPointerDown={onSeamPointerDown}
                onPointerMove={onSeamPointerMove}
                onPointerUp={endSeamDrag}
                onPointerCancel={endSeamDrag}
                onKeyDown={onSeamKeyDown}
                onDoubleClick={resetWidth}
                onMouseEnter={() => setSeamActive(true)}
                onMouseLeave={() => setSeamActive(false)}
                onFocus={() => setSeamActive(true)}
                onBlur={() => setSeamActive(false)}
                style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: -3,
                    width: 7,
                    zIndex: 3,
                    cursor: 'col-resize',
                    touchAction: 'none',
                    background: seamActive || dragging ? 'rgba(77,171,247,0.6)' : 'transparent',
                }}
            />
            <Stack gap="xs" p="sm" style={{ borderBottom: '1px solid #373a40' }}>
                <Group justify="space-between" wrap="nowrap" gap="xs">
                    <Text fw={700} c="gray.0">
                        {t('panelTitle')}
                    </Text>
                    <Group gap="xs" wrap="nowrap">
                        {onLocaleChange ? (
                            <SegmentedControl
                                aria-label={t('localeLabel')}
                                data-testid="simulator-locale"
                                size="xs"
                                value={locale}
                                data={[...LOCALES]}
                                onChange={(value) => onLocaleChange(value)}
                            />
                        ) : null}
                        <UnstyledButton
                            data-testid="simulator-collapse"
                            aria-label={t('collapseAriaLabel')}
                            onClick={toggle}
                            style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: '#f8f9fa',
                                border: '1px solid #373a40',
                                borderRadius: 6,
                                padding: '4px 10px',
                            }}
                        >
                            {t('collapseButton')}
                        </UnstyledButton>
                    </Group>
                </Group>
                {/* role="group" so the aria-label is permitted (ARIA prohibits naming a generic
                    div — the a11y sweep's axe pass enforces that). */}
                <Group
                    gap="xs"
                    wrap="nowrap"
                    role="group"
                    data-testid="simulator-person"
                    aria-label={t('personChipLabel')}
                    style={{ minWidth: 0 }}
                >
                    <Text size="xs" c="gray.4" truncate>
                        {person ? (person.name ?? person.email) : t('personChipSignedOut')}
                    </Text>
                    {person?.status === 'invited' ? (
                        <Text size="xs" c="gray.3" style={{ ...chipStyle, flexShrink: 0 }}>
                            {t('peopleInvitedBadge')}
                        </Text>
                    ) : null}
                </Group>
            </Stack>
            <Group gap={4} p="xs" wrap="wrap" style={{ borderBottom: '1px solid #373a40' }}>
                {tabs.map((tab) => (
                    <UnstyledButton
                        key={tab.id}
                        data-testid={`simulator-tab-${tab.id}`}
                        onClick={() => selectTab(tab.id)}
                        style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: '#f8f9fa',
                            background: activeTab === tab.id ? 'rgba(255,255,255,0.12)' : 'transparent',
                            borderRadius: 6,
                            padding: '6px 8px',
                        }}
                    >
                        {tab.label}
                    </UnstyledButton>
                ))}
            </Group>
            {/* The sticky aside is viewport-height, so this box really scrolls — it needs to be
                keyboard-focusable (scrollable-region-focusable) for arrow-key scrolling. While
                dragging the seam, pointerEvents:none lets the capture ride over the mail iframe. */}
            <Box
                p="sm"
                role="region"
                aria-label={t('panelTitle')}
                tabIndex={0}
                style={{ flex: 1, overflowY: 'auto', pointerEvents: dragging ? 'none' : undefined }}
            >
                {showing('people') ? (
                    <>
                        {/* Either/or, never both: signed out, the hint has to explain that picking
                            anyone signs you in; signed in, it explains what clicking a row does. Both
                            carry the same invited-row caveat, because selecting an invited person is a
                            viewpoint change and not a sign-in (see world.ts's `invited:` branch). */}
                        <Text size="xs" c="gray.5" mb="sm">
                            {signedIn ? t('peopleHint') : t('signedOutHint')}
                        </Text>
                        <PeopleApp people={people} viewpoint={viewpoint} onSelect={onSelect} />
                    </>
                ) : null}
                {showing('mail') ? (
                    <Stack gap="lg">
                        <InboundApp {...inbound} />
                        <MailApp {...mail} />
                    </Stack>
                ) : null}
                {showing('events') ? <EventsApp events={events} audit={audit} /> : null}
                {showing('jobs') ? <JobsApp {...jobs} /> : null}
                {showing('messages') ? <MessagesApp messages={messages} /> : null}
                {showing('hooks') ? <HooksApp {...hooks} /> : null}
                {/* App tabs render their host-built content here (between Hooks and Errors). An ordinary
                    tab's live content (iframe / mounted node) unmounts with it; a keepMounted one is there
                    from page load, stays put, and is only hidden (./tab-mount). */}
                {extraTabs.map((tab) => {
                    const mount = tabMount(tab, mountState)
                    return mount === 'none' ? null : (
                        <Box key={tab.id} style={mount === 'hidden' ? { display: 'none' } : undefined}>
                            {tab.content}
                        </Box>
                    )
                })}
                {showing('errors') ? (
                    <Box style={lightBoxStyle}>
                        <ErrorsApp runServerScenario={runServerErrorScenario} />
                    </Box>
                ) : null}
                {showing('snapshots') ? <SnapshotsApp {...snapshots} /> : null}
                {showing('tours') && tours ? <ToursApp {...tours} /> : null}
            </Box>
            {/* Notices overlay the panel's bottom edge (absolute, not in flow) so a transient
                confirmation never shoves the scroll body — no layout shift when one appears. */}
            {notices.length > 0 ? (
                <Box
                    role="status"
                    p="xs"
                    style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        zIndex: 2,
                        background: '#1a1b1e',
                        borderTop: '1px solid #373a40',
                    }}
                >
                    {notices.map((notice) => (
                        <Text key={notice.id} size="xs" c="yellow.3" data-testid="simulator-notice">
                            {notice.text}
                        </Text>
                    ))}
                </Box>
            ) : null}
        </Box>
    ) : null

    return (
        <>
            {pill}
            {panel}
        </>
    )
}
