'use client'

import { Box, Group, Stack, Text, UnstyledButton } from '@mantine/core'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActorId } from '@app-config/actors'
import type { ActorLog, ActorLogEntry } from './actor-runtime'
import { formatTimeShort } from './format-when'

const MAX_LOG_ENTRIES = 50
const DEFAULT_INTERVAL_MS = 3_000
const MAX_BACKOFF_MS = 15_000

const buttonStyle = {
    fontSize: 12,
    fontWeight: 600,
    color: '#f8f9fa',
    border: '1px solid #373a40',
    borderRadius: 6,
    padding: '4px 12px',
} as const

type ActorState = 'running' | 'paused' | 'ticking' | 'held'

/** data-state → status-dot colour cue. Presentational only; the label stays translated. */
function stateColor(state: ActorState): string {
    switch (state) {
        case 'ticking':
            return 'blue.4'
        case 'held':
            return 'yellow.4'
        case 'running':
            return 'teal.4'
        default:
            return 'gray.5'
    }
}

export interface ActorShellProps {
    actor: ActorId
    /** One iteration of the actor's work. The shell supplies the log sink; the caller closes over
     *  its driver + memory. A throw triggers the error note + exponential backoff. */
    tick: (log: ActorLog) => Promise<void>
    startPaused: boolean
    /** The WORLD's hold on its counterparties (e.g. a Simulator flag), asked before every AUTONOMOUS
     *  tick: while it answers true the loop keeps its schedule but does nothing. A manual Step is an
     *  explicit operator act and ignores it. Omit for an actor the world never holds. */
    held?: () => boolean | Promise<boolean>
    intervalMs?: number
    /** Compact skin for the Actors-tab card (vs. the full-page host frame). */
    inline?: boolean
}

/**
 * The shared process UI + scheduler behind both actor frames (ADR-0006 twin lives in
 * keel/demo-static). A setTimeout CHAIN — the next tick is scheduled only after the previous one
 * resolves, so ticks never overlap. Pause/resume halts and restarts the chain; Step runs exactly one
 * awaited tick while paused (disabled mid-tick, which is the await handle a test waits on). The log
 * is a 50-entry ring buffer; a thrown tick logs the error note and doubles the interval (capped
 * 15s), reset on the next success. Dark-skinned to match the Simulator panel — it reads as "not the
 * product". Router- and transport-agnostic: the `tick` closure owns all I/O.
 */
export function ActorShell({ actor, tick, startPaused, held, intervalMs, inline = false }: ActorShellProps) {
    const t = useTranslations('simulator')
    const locale = useLocale()
    const baseInterval = intervalMs ?? DEFAULT_INTERVAL_MS

    const [paused, setPaused] = useState(startPaused)
    const [ticking, setTicking] = useState(false)
    const [entries, setEntries] = useState<ActorLogEntry[]>([])
    const [worldHeld, setWorldHeld] = useState(false)

    const pausedRef = useRef(startPaused)
    const tickingRef = useRef(false)
    const intervalRef = useRef(baseInterval)
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const mountedRef = useRef(false)

    const log = useCallback<ActorLog>((entry) => {
        setEntries((prev) => {
            const next: ActorLogEntry[] = [
                ...prev,
                { at: new Date().toISOString(), line: entry.line, note: entry.note },
            ]
            return next.length > MAX_LOG_ENTRIES ? next.slice(next.length - MAX_LOG_ENTRIES) : next
        })
    }, [])

    const runTick = useCallback(async () => {
        if (tickingRef.current) return
        tickingRef.current = true
        setTicking(true)
        try {
            await tick(log)
            intervalRef.current = baseInterval // success resets the backoff
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            log({ line: `tick error → ${message}`, note: t('actorNoteError', { message }) })
            intervalRef.current = Math.min(intervalRef.current * 2, MAX_BACKOFF_MS)
        } finally {
            tickingRef.current = false
            setTicking(false)
        }
    }, [tick, log, t, baseInterval])

    // Keep the scheduler pointed at the latest runTick without re-creating the (stable) scheduler.
    const runTickRef = useRef(runTick)
    useEffect(() => {
        runTickRef.current = runTick
    }, [runTick])

    // An autonomous tick asks the world first. A failed answer counts as "not held": the tick itself
    // then surfaces whatever is wrong through the usual error note + backoff.
    const heldRef = useRef(held)
    useEffect(() => {
        heldRef.current = held
    }, [held])
    const autonomousTick = useCallback(async () => {
        let isHeld = false
        try {
            isHeld = (await heldRef.current?.()) ?? false
        } catch {
            isHeld = false
        }
        setWorldHeld(isHeld)
        if (!isHeld) await runTickRef.current()
    }, [])

    // The chain: clear any pending timer, then (unless paused/unmounted) arm the next tick, which
    // re-arms itself (via armRef — no self-reference) once it resolves. Stable (refs only) so
    // mount/toggle can call it freely.
    const armRef = useRef<() => void>(() => {})
    const arm = useCallback(() => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current)
            timeoutRef.current = null
        }
        if (pausedRef.current || !mountedRef.current) return
        timeoutRef.current = setTimeout(() => {
            timeoutRef.current = null
            void autonomousTick().finally(() => armRef.current())
        }, intervalRef.current)
    }, [autonomousTick])
    useEffect(() => {
        armRef.current = arm
    }, [arm])

    useEffect(() => {
        mountedRef.current = true
        if (!pausedRef.current) arm()
        return () => {
            mountedRef.current = false
            if (timeoutRef.current) clearTimeout(timeoutRef.current)
        }
    }, [arm])

    function toggle() {
        const next = !pausedRef.current
        pausedRef.current = next
        setPaused(next)
        if (next) {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current)
                timeoutRef.current = null
            }
        } else {
            arm()
        }
    }

    function step() {
        if (!pausedRef.current || tickingRef.current) return
        void runTickRef.current()
    }

    const state: ActorState = ticking ? 'ticking' : paused ? 'paused' : worldHeld ? 'held' : 'running'

    return (
        <Box
            data-testid="actor-shell"
            data-actor={actor}
            style={{
                background: '#1a1b1e',
                color: '#f8f9fa',
                borderRadius: inline ? 8 : 0,
                border: inline ? '1px solid rgba(255,255,255,0.12)' : 'none',
                padding: inline ? 12 : 24,
                minHeight: inline ? undefined : '100vh',
            }}
        >
            <Stack gap="sm">
                <Group justify="space-between" wrap="nowrap" gap="xs">
                    {/* The full-page host is a standalone document (and each iframe is too), so its
                        title is the page's level-one heading — axe requires one. The inline card
                        lives inside the dashboard's own <h1>, so it stays a plain <p>. */}
                    <Text component={inline ? 'p' : 'h1'} size={inline ? 'sm' : 'md'} fw={700} c="gray.0" truncate>
                        {t('actorFrameTitle', { actor })}
                    </Text>
                    <Group gap={8} wrap="nowrap" data-testid="actor-status" data-state={state}>
                        <Box
                            aria-hidden
                            style={{
                                width: 8,
                                height: 8,
                                borderRadius: 999,
                                background: `var(--mantine-color-${stateColor(state).replace('.', '-')})`,
                            }}
                        />
                        <Text size="xs" fw={700} c={stateColor(state)}>
                            {paused ? t('actorPaused') : worldHeld ? t('actorHeld') : t('actorRunning')}
                        </Text>
                    </Group>
                </Group>

                <Group gap={8} wrap="nowrap">
                    <UnstyledButton data-testid="actor-toggle" onClick={toggle} style={buttonStyle}>
                        {paused ? t('actorResumeButton') : t('actorPauseButton')}
                    </UnstyledButton>
                    <UnstyledButton
                        data-testid="actor-step"
                        onClick={step}
                        disabled={!paused || ticking}
                        style={{ ...buttonStyle, opacity: !paused || ticking ? 0.4 : 1 }}
                    >
                        {t('actorStepButton')}
                    </UnstyledButton>
                </Group>

                <Text size="xs" fw={700} c="gray.4" tt="uppercase" style={{ letterSpacing: 0.4 }}>
                    {t('actorLogHeading')}
                </Text>
                {entries.length === 0 ? (
                    <Text size="sm" c="gray.5" data-testid="actor-log-empty">
                        {t('actorLogEmpty')}
                    </Text>
                ) : (
                    <Stack
                        gap={2}
                        data-testid="actor-log"
                        style={{ maxHeight: inline ? 220 : '60vh', overflowY: 'auto' }}
                    >
                        {entries.map((entry, index) => (
                            <Box
                                // Log entries are append-only and never reordered, so the index is a
                                // stable key here.
                                key={`${entry.at}-${index}`}
                                data-testid="actor-log-entry"
                                style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '4px 0' }}
                            >
                                <Group gap={8} wrap="nowrap" align="baseline">
                                    <Text size="xs" c="gray.6" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                                        {formatTimeShort(entry.at, locale)}
                                    </Text>
                                    <Text
                                        size="xs"
                                        c="gray.2"
                                        style={{ fontFamily: 'monospace', wordBreak: 'break-all', minWidth: 0 }}
                                    >
                                        {entry.line}
                                    </Text>
                                </Group>
                                {entry.note ? (
                                    <Text size="xs" c="gray.5" pl={4}>
                                        {entry.note}
                                    </Text>
                                ) : null}
                            </Box>
                        ))}
                    </Stack>
                )}
            </Stack>
        </Box>
    )
}
