'use client'

import { Group, Stack, Text } from '@mantine/core'
import { useLocale, useTranslations } from 'next-intl'
import { formatWhen } from './simulator/format-when'

/** Presentational shape — the timeline entry as both the product route and the world view expose it. */
export interface JobTimelineItem {
    status: string
    at: string
    message?: string | null
}

/**
 * Reusable, router-agnostic status timeline: one line per transition (queued → running → …), each
 * with a localized status label and the moment it happened. Colour is inherited (never set), so the
 * same component reads correctly on the light product card AND inside the dark Simulator panel — the
 * host controls the text colour, the muted timestamp just drops opacity on whatever that colour is.
 */
export function JobTimeline({ timeline }: { timeline: JobTimelineItem[] }) {
    const t = useTranslations('jobTimeline')
    const locale = useLocale()

    function statusLabel(status: string): string {
        switch (status) {
            case 'queued':
                return t('statusQueued')
            case 'running':
                return t('statusRunning')
            case 'completed':
                return t('statusCompleted')
            case 'failed':
                return t('statusFailed')
            default:
                return status
        }
    }

    return (
        <Stack gap={2} data-testid="job-timeline">
            {timeline.map((entry) => (
                <Group
                    key={`${entry.status}-${entry.at}`}
                    gap={8}
                    wrap="nowrap"
                    data-testid={`job-timeline-entry-${entry.status}`}
                    style={{ color: 'inherit' }}
                >
                    <Text size="xs" fw={600} style={{ color: 'inherit', flexShrink: 0 }}>
                        {statusLabel(entry.status)}
                    </Text>
                    <Text size="xs" style={{ color: 'inherit', opacity: 0.7, whiteSpace: 'nowrap' }}>
                        {formatWhen(entry.at, locale)}
                    </Text>
                    {entry.message ? (
                        <Text size="xs" truncate style={{ color: 'inherit', opacity: 0.7, minWidth: 0 }}>
                            {entry.message}
                        </Text>
                    ) : null}
                </Group>
            ))}
        </Stack>
    )
}
