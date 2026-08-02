'use client'

import { Group, Stack, Switch, Text, UnstyledButton } from '@mantine/core'
import { useTranslations } from 'next-intl'

/** One registered tour, with its copy already resolved by the host (the seam carries keys, the host
 *  translates — the same contract every other app registration on this panel uses). */
export interface TourListing {
    id: string
    title: string
    summary: string
}

export interface ToursAppProps {
    tours: TourListing[]
    /** The tour currently running, if any — its row says so, and the others are unavailable. */
    activeId: string | null
    /** Preview speed: the ghost cursor stops pausing for a human to read. */
    fast: boolean
    onFastChange: (fast: boolean) => void
    onStart: (id: string) => void
}

const tourActionStyle = {
    fontSize: 12,
    fontWeight: 600,
    color: '#f8f9fa',
    border: '1px solid #373a40',
    borderRadius: 6,
    padding: '4px 10px',
} as const

/**
 * Router-agnostic Tours tab: the world's SCRIPTED WALKTHROUGHS, beside Snapshots because they are the same
 * idea in two dimensions — a snapshot is world state, a tour is world narrative, and a tour starts by
 * restoring a snapshot.
 *
 * Why it exists: `dist-demo/index.html` is one file you can email to a stakeholder, and until now
 * seeing the product in it meant reading a runbook and clicking fifteen things in the right order.
 * Here they press Start and read.
 *
 * The tab renders only when the app registers at least one tour (keel/demo-static/tour/use-tours), so
 * an adopter who registers none never sees it.
 */
export function ToursApp({ tours, activeId, fast, onFastChange, onStart }: ToursAppProps) {
    const t = useTranslations('simulator')

    return (
        <Stack gap="md" data-testid="simulator-tours">
            <Stack gap="xs">
                <Text size="sm" fw={700} c="gray.0">
                    {t('toursHeading')}
                </Text>
                <Text size="xs" c="gray.5">
                    {t('toursHint')}
                </Text>
                <Switch
                    label={t('toursFastLabel')}
                    checked={fast}
                    size="xs"
                    styles={{ label: { color: '#f8f9fa' } }}
                    data-testid="tour-fast"
                    onChange={(event) => onFastChange(event.currentTarget.checked)}
                />
            </Stack>

            <Stack gap="xs" data-testid="tours-list">
                {tours.map((tour) => {
                    const running = activeId === tour.id
                    return (
                        <Group
                            key={tour.id}
                            justify="space-between"
                            wrap="nowrap"
                            align="start"
                            data-testid={`tour-row-${tour.id}`}
                            style={{
                                borderRadius: 8,
                                padding: '6px 10px',
                                border: '1px solid rgba(255,255,255,0.15)',
                            }}
                        >
                            <Stack gap={0} style={{ minWidth: 0 }}>
                                <Text size="sm" fw={600} c="gray.0">
                                    {tour.title}
                                </Text>
                                <Text size="xs" c="gray.5">
                                    {tour.summary}
                                </Text>
                            </Stack>
                            <UnstyledButton
                                data-testid={`tour-start-${tour.id}`}
                                disabled={activeId !== null}
                                onClick={() => onStart(tour.id)}
                                style={{ ...tourActionStyle, flexShrink: 0, opacity: activeId !== null ? 0.6 : 1 }}
                            >
                                {running ? t('toursRunning') : t('toursStart')}
                            </UnstyledButton>
                        </Group>
                    )
                })}
            </Stack>
        </Stack>
    )
}
