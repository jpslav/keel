'use client'

import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { type ActorLog, builderTick, type ServiceMemory, serviceTick } from 'keel/components/simulator/actor-runtime'
import { ActorShell } from 'keel/components/simulator/actor-shell'
import type { ActorId } from '@app-config/actors'
import { createBuilderDriver, createServiceDriver } from './drivers'

/**
 * The full-page host behind an actor iframe (ADR-0006 twin: the static demo hosts ActorShell inline
 * instead). It wires the REAL fetch drivers + per-actor memory to the shared shell exactly once, and
 * gates on mount so `?paused=1` can be read from window.location.search client-side (no
 * useSearchParams → no Suspense boundary) and no tick fires before the shell exists. The driver logs
 * auxiliary calls through a mutable ref the tick closure repoints at the shell's log each tick.
 */
export function ActorHost({ actor }: { actor: ActorId }) {
    const t = useTranslations('simulator')

    // Driver + memory are built lazily on the FIRST tick, bound to the shell's stable log — so the
    // cached credential and claimed-set survive across ticks without any ref being read during
    // render. Cached in a ref because construction happens inside the tick callback, never in render.
    const boundRef = useRef<((log: ActorLog) => Promise<void>) | null>(null)
    const tick = useCallback(
        (log: ActorLog) => {
            if (!boundRef.current) {
                if (actor === 'bundle-analyzer') {
                    const driver = createServiceDriver({ log, t })
                    const memory: ServiceMemory = { claimed: new Set() }
                    boundRef.current = (next) => serviceTick(driver, memory, next, t)
                } else {
                    const driver = createBuilderDriver({ log, t })
                    boundRef.current = (next) => builderTick(driver, next, t)
                }
            }
            return boundRef.current(log)
        },
        [actor, t],
    )

    // The world's hold on THIS actor (the `actors-held` Snapshots flag, or a preset's per-actor hold),
    // asked before every autonomous tick — the frame is its own document, so it asks the server, which
    // answers exactly this question.
    const held = useCallback(async () => {
        const res = await fetch(`/api/simulator/actors/held?actor=${encodeURIComponent(actor)}`)
        if (!res.ok) throw new Error(`held → ${res.status}`)
        const { held: isHeld } = (await res.json()) as { held: boolean }
        return isHeld
    }, [actor])

    const [mounted, setMounted] = useState(false)
    const [startPaused, setStartPaused] = useState(false)

    useEffect(() => {
        // Client-only: read ?paused=1 straight off the URL (no useSearchParams → no Suspense), then
        // reveal the shell. Rendering only after mount guarantees no tick fires before this runs.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setStartPaused(new URLSearchParams(window.location.search).get('paused') === '1')
        setMounted(true)
    }, [])

    if (!mounted) return null
    // A landmark for the standalone actor page (and each iframe document): without it the shell's
    // content sits outside any region, which axe flags. The inline twin renders ActorShell directly
    // inside the dashboard's own <main>, so only this full-page host adds the wrapper.
    return (
        <main style={{ minHeight: '100vh' }}>
            <ActorShell actor={actor} tick={tick} startPaused={startPaused} held={held} />
        </main>
    )
}
