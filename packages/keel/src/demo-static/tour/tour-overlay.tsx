'use client'

import { Box, Button, Group, Stack, Text, UnstyledButton } from '@mantine/core'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import type { TourMiss } from './contracts'
import { CURSOR_ID, CURSOR_RING_ID } from './driver'

/**
 * Everything a running tour puts ON TOP of the app: the ghost cursor the driver moves, the vignette
 * backdrop a spotlight dims the page with, the narration bar, and the end-of-run report.
 *
 * Deliberately one component: all four are the same overlay layer, they share a z-index budget, and a
 * host should mount ONE node beside the Simulator panel rather than remember four.
 *
 * Z-INDEX BUDGET (the panel's pill sits at 1000): backdrop 1100, spotlit target 1150 (set inline by
 * the engine), cursor 1300, bar 1200. The cursor stays above the bar so it can visibly travel over it.
 */

export interface TourOverlayProps {
    /** A tour is running: the bar and the cursor exist. */
    active: boolean
    /** Zero-based index of the step being narrated, and how many there are. */
    stepIndex: number
    total: number
    /** The step's narration, already translated (rich text: the app's catalog may bold a term). */
    narration: ReactNode
    /** An `advance` script is mid-flight — the buttons lock so a double Next cannot skip a beat. */
    advancing: boolean
    /** Whether a spotlight is currently lit (the engine only reports true once its target exists). */
    spotlit: boolean
    /** Targets this run has asked for and not found. Shown as they happen, so an author sees the break
     *  where it happened rather than in a log. */
    misses: TourMiss[]
    /** The viewer navigated away from the tour's storyline under their own steam. */
    derailed: boolean
    /** Set when the run ends (finished or exited) — the strip CI reads to decide whether the tour is
     *  still true. Cleared by the viewer. */
    report: { steps: number; misses: TourMiss[] } | null
    onNext: () => void
    onBack: () => void
    onExit: () => void
    onResume: () => void
    onDismissReport: () => void
}

const barStyle = {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1200,
    background: '#1a1b1e',
    color: '#f8f9fa',
    borderTop: '1px solid #373a40',
    boxShadow: '0 -6px 30px rgba(0,0,0,0.35)',
    padding: '10px 16px',
} as const

export function TourOverlay({
    active,
    stepIndex,
    total,
    narration,
    advancing,
    spotlit,
    misses,
    derailed,
    report,
    onNext,
    onBack,
    onExit,
    onResume,
    onDismissReport,
}: TourOverlayProps) {
    const t = useTranslations('simulator')

    return (
        <>
            {/* The vignette. Pointer-events off: it dims, it never intercepts — the driver still has to
                click through it, and so does anyone who wants to poke at the highlighted thing. */}
            {active && spotlit ? (
                <Box
                    data-testid="tour-spotlight"
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 1100,
                        background: 'rgba(16,30,42,0.66)',
                        pointerEvents: 'none',
                    }}
                />
            ) : null}

            {/* The ghost cursor. Positioned only by the driver (transform), so React never re-renders
                on movement; the transition is what makes it glide rather than teleport. */}
            {active ? (
                <Box
                    id={CURSOR_ID}
                    aria-hidden
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        zIndex: 1300,
                        opacity: 0,
                        pointerEvents: 'none',
                        transition: 'transform .68s cubic-bezier(.3,.75,.3,1), opacity .3s',
                        filter: 'drop-shadow(0 2px 7px rgba(16,30,42,.45))',
                    }}
                >
                    <svg width="33" height="33" viewBox="0 0 24 24">
                        <path d="M5 3l14 8-6.5 1.5L9 19z" fill="#14232f" stroke="#fff" strokeWidth="1.6" />
                    </svg>
                    <Box
                        id={CURSOR_RING_ID}
                        style={{
                            position: 'absolute',
                            top: -9,
                            left: -9,
                            width: 50,
                            height: 50,
                            borderRadius: '50%',
                            border: '3.5px solid #fcc419',
                            background: 'rgba(252,196,25,0.18)',
                            opacity: 0,
                        }}
                    />
                </Box>
            ) : null}

            {active ? (
                <Box component="aside" aria-label={t('tourBarLabel')} data-testid="tour-bar" style={barStyle}>
                    <Group gap="md" wrap="nowrap" align="center">
                        <Text
                            size="xs"
                            fw={800}
                            data-testid="tour-progress"
                            data-step={stepIndex + 1}
                            data-total={total}
                            style={{ flexShrink: 0, background: '#373a40', borderRadius: 8, padding: '4px 8px' }}
                        >
                            {t('tourProgress', { step: stepIndex + 1, total })}
                        </Text>
                        {/* Constant-ish height with its own scroll, so the buttons never move under a
                            longer step. 120px is five lines at the narrow end of the layout (panel
                            open on a small laptop), which is as long as narration should ever be. */}
                        <Stack gap={4} style={{ flex: 1, minWidth: 0, maxHeight: 120, overflowY: 'auto' }}>
                            <Text size="sm" c="gray.2" data-testid="tour-narration">
                                {narration}
                            </Text>
                            {derailed ? (
                                <Text size="xs" c="yellow.4" data-testid="tour-derailed">
                                    {t('tourDerailedHint')}
                                </Text>
                            ) : null}
                            {misses.map((miss) => (
                                <Text key={`${miss.action}:${miss.target}`} size="xs" c="red.4" data-testid="tour-miss">
                                    {t('tourMiss', { action: miss.action, target: miss.target })}
                                </Text>
                            ))}
                        </Stack>
                        <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
                            {derailed ? (
                                <Button size="xs" variant="default" data-testid="tour-resume" onClick={onResume}>
                                    {t('tourResume')}
                                </Button>
                            ) : null}
                            <UnstyledButton
                                data-testid="tour-exit"
                                onClick={onExit}
                                style={{ fontSize: 12, color: '#909296', textDecoration: 'underline' }}
                            >
                                {t('tourExit')}
                            </UnstyledButton>
                            <Button
                                size="xs"
                                variant="default"
                                data-testid="tour-back"
                                disabled={stepIndex === 0 || advancing}
                                onClick={onBack}
                            >
                                {t('tourBack')}
                            </Button>
                            <Button size="xs" data-testid="tour-next" loading={advancing} onClick={onNext}>
                                {stepIndex >= total - 1 ? t('tourFinish') : t('tourNext')}
                            </Button>
                        </Group>
                    </Group>
                </Box>
            ) : null}

            {/* The run report. It outlives the tour on purpose: a presenter sees "that ran clean", and
                the CI walkthrough asserts data-misses="0" here after clicking the story to its end. */}
            {report ? (
                <Box role="status" data-testid="tour-report" data-misses={report.misses.length} style={barStyle}>
                    <Group gap="md" wrap="nowrap" align="center">
                        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                            <Text size="sm" fw={700} c={report.misses.length === 0 ? 'teal.4' : 'red.4'}>
                                {report.misses.length === 0
                                    ? t('tourReportClean', { steps: report.steps })
                                    : t('tourReportProblems', {
                                          steps: report.steps,
                                          count: report.misses.length,
                                      })}
                            </Text>
                            {report.misses.map((miss) => (
                                <Text
                                    key={`${miss.action}:${miss.target}`}
                                    size="xs"
                                    c="red.4"
                                    data-testid="tour-report-miss"
                                >
                                    {t('tourMiss', { action: miss.action, target: miss.target })}
                                </Text>
                            ))}
                        </Stack>
                        <Button size="xs" variant="default" data-testid="tour-report-dismiss" onClick={onDismissReport}>
                            {t('tourReportDismiss')}
                        </Button>
                    </Group>
                </Box>
            ) : null}
        </>
    )
}
