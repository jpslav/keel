'use client'

import { tours as appTours } from '@app-config/tours'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ToursAppProps } from '../../components/simulator/tours-app'
import type { TourMiss } from './contracts'
import { cancelScript, hideCursor, isDriving, requestFastForward, runScript, setDriverSpeed } from './driver'
import { TourOverlay } from './tour-overlay'

/**
 * The tour ENGINE — step state, spotlights, advance-on-Next, the derail guard, and the run report —
 * plus the two things a host needs to mount it: the Simulator tab's props and the overlay node.
 *
 * Hosts are the two places the Simulator panel is composed (the static shell and the server glue), and
 * both wire tours in two lines. The registered tours come from the SEAM (`@app-config/tours`), read
 * here exactly as SnapshotsApp reads `@app-config/simulator` flags, so keel hosts an app's walkthroughs
 * without learning a word of its vocabulary.
 *
 * A tour SURVIVES A RELOAD. That is not a nicety: on a server host, restoring a snapshot, switching
 * person and flipping a feature flag all reload the page, and a walkthrough that died on its own second
 * step would be useless there. The current tour + step is written to sessionStorage on every step and
 * resumed on mount; ending the tour clears it.
 */

/** How long the spotlight effect waits for its target before calling it a miss. */
const SPOTLIGHT_TIMEOUT_MS = 1_500
const SPOTLIGHT_POLL_MS = 60
/** How often the derail guard samples the location (there is no event that covers every router). */
const DERAIL_POLL_MS = 400
/** Fast: a preview crawl, and the speed the CI walkthrough runs a whole tour at. */
const FAST_SPEED = 0.02
const RESUME_KEY = 'app-simulator-tour'
const FAST_KEY = 'app-simulator-tour-fast'

function readStoredFast(): boolean {
    try {
        return window.localStorage.getItem(FAST_KEY) === 'true'
    } catch {
        return false
    }
}

function readResumeMarker(): { tourId: string; idx: number } | null {
    try {
        const raw = window.sessionStorage.getItem(RESUME_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw) as { tourId?: unknown; idx?: unknown }
        if (typeof parsed.tourId !== 'string' || typeof parsed.idx !== 'number') return null
        return { tourId: parsed.tourId, idx: parsed.idx }
    } catch {
        return null
    }
}

function writeResumeMarker(marker: { tourId: string; idx: number } | null) {
    try {
        if (marker) window.sessionStorage.setItem(RESUME_KEY, JSON.stringify(marker))
        else window.sessionStorage.removeItem(RESUME_KEY)
    } catch {
        // A host with storage disabled loses only the resume-after-reload ability.
    }
}

export interface ToursHandle {
    /** Hand to `<SimulatorPanel tours={…}>`. Undefined when the app registers no tours, which is how
     *  the tab disappears entirely for an adopter who wants none. */
    tab: ToursAppProps | undefined
    /** Render once, beside the panel: cursor, vignette, narration bar, run report. */
    overlay: React.ReactNode
}

export function useTours(
    options: {
        /**
         * Put the world into the start a tour declares, before its first step — resolved by the host with
         * keel/core/presets.ts `resolveWorldStart`: `'reset'` (the seeded world) and every registered demo
         * preset work on every host; a server host may also restore a saved snapshot. On a host where that
         * reloads the page, the tour resumes itself afterwards. Answer `false` when this host cannot
         * produce that world: the tour still runs, but its start is recorded as a miss, which fails the
         * CI walkthrough rather than letting a tour quietly begin in the wrong world.
         */
        onSnapshot?: (snapshot: string) => void | boolean | Promise<void | boolean>
    } = {},
): ToursHandle {
    const { onSnapshot } = options
    const t = useTranslations()
    const [activeId, setActiveId] = useState<string | null>(null)
    const [idx, setIdx] = useState(-1)
    const [advancing, setAdvancing] = useState(false)
    const [spotlight, setSpotlight] = useState<string | null>(null)
    const [spotlit, setSpotlit] = useState(false)
    const [misses, setMisses] = useState<TourMiss[]>([])
    const [derailed, setDerailed] = useState(false)
    const [report, setReport] = useState<{ steps: number; misses: TourMiss[] } | null>(null)
    const [fast, setFast] = useState(false)

    // Read by the scroll listener, which is registered once and must not be re-registered per step.
    // Synced in an effect rather than written during render: a ref write during render is banned
    // (react-hooks/refs), and this is the same "mirror state for a listener" shape world.ts uses.
    const idxRef = useRef(idx)
    useEffect(() => {
        idxRef.current = idx
    }, [idx])
    // Where the story is meant to be standing: captured when a step's entry script finishes, and the
    // place "Back to the tour" returns to.
    const stepLocationRef = useRef<string | null>(null)
    // Bumped on every goto so a script that finishes AFTER the viewer pressed Back cannot light that
    // abandoned step's spotlight on the screen they are now looking at.
    const runTokenRef = useRef(0)

    const tour = appTours.find((candidate) => candidate.id === activeId) ?? null
    const steps = tour?.steps ?? []
    const touring = idx >= 0 && tour !== null

    // Mirrors the misses state for end(): next()'s closure predates any miss its own advance script
    // records, so the run report must read the CURRENT list, not the render-time one — a final-step
    // advance miss would otherwise vanish from the report (and from the CI gate that asserts on it).
    const missesRef = useRef<TourMiss[]>([])
    const addMiss = useCallback((miss: TourMiss) => {
        if (missesRef.current.some((seen) => seen.action === miss.action && seen.target === miss.target)) return
        missesRef.current = [...missesRef.current, miss]
        setMisses(missesRef.current)
    }, [])

    // The controls below are deliberately PLAIN FUNCTIONS, not useCallbacks: they are event handlers,
    // nothing downstream memoizes on their identity, and a useCallback closing over the tour registry
    // is manual memoization the React Compiler cannot verify (it reports the module-level array as
    // "may be modified later"). `addMiss` above stays memoized because an effect depends on it.

    function goto(tourId: string, next: number) {
        const target = appTours.find((candidate) => candidate.id === tourId)
        const step = target?.steps[next]
        if (!target || !step) return
        cancelScript()
        const token = (runTokenRef.current += 1)
        setActiveId(tourId)
        setIdx(next)
        setDerailed(false)
        setReport(null)
        // The vignette lights AFTER the entry script, not before it: the script is usually what puts
        // the target on screen (it navigates, or opens a panel tab), so lighting first would race it —
        // and did, at presentation speed, where the wait timed out before the cursor had finished
        // walking there. It also paces better: dim, then halo, once the cursor arrives.
        setSpotlight(null)
        writeResumeMarker({ tourId, idx: next })
        stepLocationRef.current = window.location.href
        void runScript(step.script, addMiss).then(() => {
            if (runTokenRef.current !== token) return
            // The baseline for the derail guard is where the STEP left the viewer, not where it
            // started — a step whose script navigates has moved the story on purpose.
            stepLocationRef.current = window.location.href
            setSpotlight(step.spotlight ?? null)
        })
    }

    function end(stepsRun: number) {
        cancelScript()
        hideCursor()
        writeResumeMarker(null)
        setReport({ steps: stepsRun, misses: missesRef.current })
        setActiveId(null)
        setIdx(-1)
        setAdvancing(false)
        setSpotlight(null)
        setDerailed(false)
    }

    async function start(tourId: string) {
        const target = appTours.find((candidate) => candidate.id === tourId)
        if (!target) return
        missesRef.current = []
        setMisses([])
        setReport(null)
        // Snapshot first: a tour begins from a world it can describe, not from wherever the last person
        // clicked. On a server host this reloads, and the resume marker takes over.
        writeResumeMarker({ tourId, idx: 0 })
        if (target.snapshot && onSnapshot) {
            // A host that could not produce the world answers false; one whose request failed outright
            // (a network error, a throw) is the same miss, never an unhandled rejection that leaves the
            // resume marker pointing at a tour that never began.
            const produced = await Promise.resolve()
                .then(() => onSnapshot(target.snapshot!))
                .catch(() => false as const)
            if (produced === false) addMiss({ action: 'snapshot', target: target.snapshot })
        }
        goto(tourId, 0)
    }

    async function next() {
        if (advancing || !tour) return
        const step = tour.steps[idx]
        setAdvancing(true)
        // Next DURING an entry script fast-forwards it to completion rather than cancelling it: a
        // cancelled script leaves a half-typed form on screen, which reads as a bug.
        if (isDriving()) {
            requestFastForward()
            while (isDriving()) await new Promise((resolve) => setTimeout(resolve, 60))
        }
        // Move the resume marker BEFORE the advance script runs. Every submission lives in `advance`,
        // and on a server host some of them reload the page (a feature flag, a person switch) — writing
        // the marker first is the difference between coming back on the next beat and replaying the
        // action that caused the reload.
        writeResumeMarker(idx + 1 < tour.steps.length ? { tourId: tour.id, idx: idx + 1 } : null)
        if (step?.advance) {
            setSpotlight(null) // the vignette lifts before the cursor clicks through it
            await runScript(step.advance, addMiss)
        }
        setAdvancing(false)
        if (idx >= tour.steps.length - 1) end(tour.steps.length)
        else goto(tour.id, idx + 1)
    }

    function back() {
        if (idx > 0 && !advancing && tour) goto(tour.id, idx - 1)
    }

    function resume() {
        setDerailed(false)
        if (!tour) return
        const home = stepLocationRef.current
        // Hash routing lands back in place without a reload; a real navigation reloads, and the resume
        // marker restarts the tour on the same step.
        if (home && window.location.href !== home) window.location.assign(home)
        goto(tour.id, idx)
    }

    useEffect(() => {
        // Mount-only external-system reads: the persisted Fast preference, and a tour interrupted by a
        // reload (a snapshot restore, a person switch, a flag flip — all of which reload a server host).
        const storedFast = readStoredFast()
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFast(storedFast)
        setDriverSpeed(storedFast ? FAST_SPEED : 1)
        const marker = readResumeMarker()
        const resumable = marker && appTours.some((candidate) => candidate.id === marker.tourId)
        if (marker && resumable) goto(marker.tourId, marker.idx)
        // Intentionally mount-only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        // The cursor is position:fixed, so the viewer's own scrolling makes its coordinates a lie —
        // hide it, and let the driver's next move bring it back.
        const onScroll = () => {
            if (idxRef.current >= 0 && !isDriving()) hideCursor()
        }
        window.addEventListener('scroll', onScroll)
        window.addEventListener('wheel', onScroll, { passive: true })
        return () => {
            window.removeEventListener('scroll', onScroll)
            window.removeEventListener('wheel', onScroll)
        }
    }, [])

    useEffect(() => {
        // The DERAIL GUARD. The template this is ported from wrapped the app's one navigation
        // function; this codebase has two hosts with two routers (hash and Next), so the guard watches
        // the LOCATION instead: if it moves while the driver is idle, the viewer went somewhere the
        // story did not, and the bar offers them the way back. Post-hoc rather than a confirmation
        // dialog, which is also less rude — clicking around mid-tour is allowed, it just says so.
        if (!touring) return
        let last = window.location.href
        const id = setInterval(() => {
            if (isDriving()) {
                last = window.location.href
                return
            }
            if (window.location.href !== last) {
                last = window.location.href
                setDerailed(true)
            }
        }, DERAIL_POLL_MS)
        return () => clearInterval(id)
    }, [touring])

    useEffect(() => {
        // The vignette: dim the page, halo the target. The backdrop renders only once the target is
        // actually there, so a stale selector never leaves the page dimmed with nothing lit — and it
        // is recorded as a miss, because a spotlight that stopped pointing at anything is exactly the
        // rot this gate exists to catch.
        if (!spotlight || !touring) {
            // Syncing an external system (the DOM styles this effect owns) back to "nothing lit" — the
            // legitimate case the set-state-in-effect rule carves out.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSpotlit(false)
            return
        }
        let target: HTMLElement | null = null
        let halo: Animation | undefined
        let previous: { position: string; zIndex: string } | null = null
        const deadline = Date.now() + SPOTLIGHT_TIMEOUT_MS
        const poll = setInterval(() => {
            const el = document.querySelector<HTMLElement>(spotlight)
            if (!el) {
                if (Date.now() > deadline) {
                    clearInterval(poll)
                    addMiss({ action: 'spotlight', target: spotlight })
                }
                return
            }
            clearInterval(poll)
            target = el
            previous = { position: el.style.position, zIndex: el.style.zIndex }
            // Lift the target above the backdrop. `static` cannot take a z-index, so it becomes
            // relative — the smallest change that makes stacking work on an arbitrary element.
            if (getComputedStyle(el).position === 'static') el.style.position = 'relative'
            el.style.zIndex = '1150'
            halo = el.animate(
                [
                    { boxShadow: '0 0 0 6px rgba(252,196,25,.75), 0 0 60px 10px rgba(252,196,25,.35)' },
                    { boxShadow: '0 0 0 11px rgba(252,196,25,.5), 0 0 70px 16px rgba(252,196,25,.22)' },
                    { boxShadow: '0 0 0 6px rgba(252,196,25,.75), 0 0 60px 10px rgba(252,196,25,.35)' },
                ],
                { duration: 1500, iterations: Infinity },
            )
            setSpotlit(true)
            try {
                el.scrollIntoView({ block: 'center', behavior: 'smooth' })
            } catch {
                // no layout engine (unit tests) — the halo is still attached
            }
        }, SPOTLIGHT_POLL_MS)
        return () => {
            clearInterval(poll)
            halo?.cancel()
            if (target && previous) {
                target.style.position = previous.position
                target.style.zIndex = previous.zIndex
            }
            setSpotlit(false)
        }
    }, [addMiss, spotlight, touring])

    useEffect(() => {
        // Keep the bar from covering the bottom of the page while a tour runs — the same trick the
        // template used, minus a stylesheet.
        if (!touring && !report) return
        const previous = document.body.style.paddingBottom
        document.body.style.paddingBottom = '150px'
        return () => {
            document.body.style.paddingBottom = previous
        }
    }, [touring, report])

    const onFastChange = useCallback((value: boolean) => {
        setFast(value)
        setDriverSpeed(value ? FAST_SPEED : 1)
        try {
            window.localStorage.setItem(FAST_KEY, String(value))
        } catch {
            // preference only
        }
    }, [])

    const tab: ToursAppProps | undefined =
        appTours.length === 0
            ? undefined
            : {
                  tours: appTours.map((candidate) => ({
                      id: candidate.id,
                      title: t(candidate.titleKey),
                      summary: t(candidate.summaryKey),
                  })),
                  activeId,
                  fast,
                  onFastChange,
                  onStart: (tourId: string) => void start(tourId),
              }

    const step = touring ? steps[idx] : undefined

    return {
        tab,
        overlay: (
            <TourOverlay
                active={touring}
                stepIndex={Math.max(idx, 0)}
                total={steps.length}
                narration={step ? t.rich(step.textKey, { b: (chunks) => <b>{chunks}</b> }) : null}
                advancing={advancing}
                spotlit={spotlit}
                misses={misses}
                derailed={derailed}
                report={report}
                onNext={() => void next()}
                onBack={back}
                onExit={() => end(idx + 1)}
                onResume={resume}
                onDismissReport={() => setReport(null)}
            />
        ),
    }
}
