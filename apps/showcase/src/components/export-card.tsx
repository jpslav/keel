'use client'

import { Anchor, Button, Card, Stack, Text, Title } from '@mantine/core'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { JobTimeline, type JobTimelineItem } from 'keel/components/job-timeline'

export interface ExportJob {
    id: string
    status: string
    createdAt: string
    timeline: JobTimelineItem[]
    downloadUrl?: string | null
    error?: string | null
}

/**
 * Router-agnostic "Export the queue" card: kicks off an export job and lists the team's recent exports
 * (most-recent-first — the caller orders them), each showing its live status timeline. A download
 * link appears once a job completes and its artifact is ready; a failed job surfaces its error
 * inline. The card is presentational — running the job and refreshing the list is the glue's job.
 * `canCreate` mirrors the route's Job-create ability (restricted members read, never submit), the
 * same reflect-the-server gate every other card carries.
 */
export function ExportCard({
    jobs,
    canCreate,
    onExport,
}: {
    jobs: ExportJob[]
    canCreate: boolean
    onExport: () => Promise<void>
}) {
    const t = useTranslations('jobs')
    const [busy, setBusy] = useState(false)

    return (
        <Card withBorder padding="lg" radius="md" data-testid="export-card">
            <Stack gap="sm">
                <Title order={2} size="h3">
                    {t('exportTitle')}
                </Title>
                <Text size="sm" c="gray.7">
                    {t('exportHint')}
                </Text>
                {canCreate ? (
                    <Button
                        loading={busy}
                        data-testid="export-run"
                        onClick={() => {
                            setBusy(true)
                            void onExport().finally(() => setBusy(false))
                        }}
                        style={{ alignSelf: 'flex-start' }}
                    >
                        {t('exportButton')}
                    </Button>
                ) : null}
                {jobs.length === 0 ? (
                    <Text c="gray.7" data-testid="export-empty">
                        {t('exportEmpty')}
                    </Text>
                ) : (
                    <Stack gap="sm" data-testid="export-list">
                        {jobs.map((job) => (
                            <Stack key={job.id} gap={4} data-testid="export-job">
                                <JobTimeline timeline={job.timeline} />
                                {job.error ? (
                                    <Text size="xs" c="red.7" data-testid="export-error">
                                        {job.error}
                                    </Text>
                                ) : null}
                                {job.downloadUrl ? (
                                    <Anchor href={job.downloadUrl} size="sm" download data-testid="job-download">
                                        {t('downloadLink')}
                                    </Anchor>
                                ) : null}
                            </Stack>
                        ))}
                    </Stack>
                )}
            </Stack>
        </Card>
    )
}
