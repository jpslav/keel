'use client'

import { Anchor, Badge, Box, Button, Card, Group, Loader, SegmentedControl, Stack, Text, Title } from '@mantine/core'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { ANALYZABLE_KIND, ATTACHMENT_KINDS, type AttachmentKind, formatBytes } from '@/domain/attachments'

/** One uploaded attachment as its team sees it. `downloadUrl` is absent in the static twin (no server). */
export interface AttachmentItem {
    id: string
    filename: string
    kind: string
    sizeBytes: number | null
    downloadUrl?: string | null
}

/** i18n key per registered kind — the second entry is why this is a map and not a constant. */
const KIND_KEY: Record<string, string> = {
    attachment: 'kindAttachment',
    'diagnostic-bundle': 'kindDiagnosticBundle',
}

/**
 * Router-agnostic attachments card. A drop region (drag-and-drop OR click-to-browse, backed by a real
 * hidden <input type="file"> — no dropzone dependency, so the file:// demo bundle stays lean and
 * Playwright's setInputFiles targets the input directly) plus the team's uploaded files. The card is
 * presentational: `onUpload` does the actual mint → POST → confirm dance (real glue) or the in-memory
 * twin (static demo). Restricted members get a read-only view, same as TicketsCard.
 * The download link is simply omitted when a row has no URL (the static twin's degrade).
 *
 * The KIND picker is what a two-member registry buys: the uploader says whether this is an ordinary
 * attachment or a diagnostic bundle, and only bundles get an Analyze button — the per-kind branch that
 * a one-kind registry could never show.
 */
export function AttachmentsCard({
    attachments,
    canCreate,
    onUpload,
    onAnalyze,
}: {
    attachments: AttachmentItem[]
    /** When false (restricted members), the drop region is hidden and a read-only hint shows. */
    canCreate: boolean
    onUpload: (file: File, kind: AttachmentKind) => Promise<void>
    /** Hands a diagnostic bundle to the analyze-bundle job. Omitted where there is no job runner. */
    onAnalyze?: (attachmentId: string) => Promise<void>
}) {
    const t = useTranslations('attachments')
    const [status, setStatus] = useState<'idle' | 'uploading' | 'error'>('idle')
    const [dragging, setDragging] = useState(false)
    const [kind, setKind] = useState<AttachmentKind>('attachment')
    const [analyzing, setAnalyzing] = useState<string | null>(null)

    async function handleFiles(files: FileList | null) {
        const file = files?.[0]
        if (!file || status === 'uploading') return
        setStatus('uploading')
        try {
            await onUpload(file, kind)
            setStatus('idle')
        } catch {
            setStatus('error')
        }
    }

    return (
        <Card withBorder padding="lg" radius="md" data-testid="attachments-card">
            <Stack gap="sm">
                <Title order={2} size="h3">
                    {t('title')}
                </Title>
                <Text size="sm" c="gray.7">
                    {t('hint')}
                </Text>

                {canCreate ? (
                    <SegmentedControl
                        size="xs"
                        value={kind}
                        data-testid="attachment-kind"
                        aria-label={t('kindLabel')}
                        onChange={(value) => setKind(value as AttachmentKind)}
                        data={ATTACHMENT_KINDS.map((k) => ({ value: k, label: t(KIND_KEY[k] ?? 'kindAttachment') }))}
                        style={{ alignSelf: 'flex-start' }}
                    />
                ) : null}

                {canCreate ? (
                    <Box
                        component="label"
                        data-dragging={dragging || undefined}
                        style={{
                            display: 'block',
                            cursor: 'pointer',
                            border: '2px dashed var(--mantine-color-gray-4)',
                            borderRadius: 'var(--mantine-radius-md)',
                            padding: 'var(--mantine-spacing-lg)',
                            textAlign: 'center',
                            background: dragging ? 'var(--mantine-color-gray-1)' : undefined,
                        }}
                        onDragOver={(event) => {
                            event.preventDefault()
                            setDragging(true)
                        }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={(event) => {
                            event.preventDefault()
                            setDragging(false)
                            void handleFiles(event.dataTransfer.files)
                        }}
                    >
                        <input
                            type="file"
                            data-testid="attachment-drop"
                            // Visually hidden but still focusable: display:none would drop the input
                            // from the tab order and the a11y tree, locking keyboard/AT users out of
                            // uploading entirely. The wrapped label keeps its accessible name.
                            style={{
                                position: 'absolute',
                                width: 1,
                                height: 1,
                                padding: 0,
                                margin: -1,
                                overflow: 'hidden',
                                clip: 'rect(0 0 0 0)',
                                whiteSpace: 'nowrap',
                                border: 0,
                            }}
                            onChange={(event) => void handleFiles(event.currentTarget.files)}
                        />
                        {status === 'uploading' ? (
                            <Group justify="center" gap="xs">
                                <Loader size="sm" />
                                <Text size="sm" c="gray.7">
                                    {t('uploading')}
                                </Text>
                            </Group>
                        ) : (
                            <Text size="sm" c="gray.7">
                                {t('dropLabel')}
                            </Text>
                        )}
                    </Box>
                ) : null}

                {status === 'error' ? (
                    <Text size="sm" c="red.7" data-testid="attachment-error">
                        {t('uploadError')}
                    </Text>
                ) : null}

                {attachments.length === 0 ? (
                    <Text c="gray.7" data-testid="attachments-empty">
                        {t('empty')}
                    </Text>
                ) : (
                    <Stack gap="xs" data-testid="attachments-list">
                        {attachments.map((attachment) => (
                            <Group
                                key={attachment.id}
                                justify="space-between"
                                wrap="nowrap"
                                data-testid={`attachment-item-${attachment.id}`}
                            >
                                <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                                    <Badge color="blue" variant="light" radius="sm">
                                        {t(KIND_KEY[attachment.kind] ?? 'kindAttachment')}
                                    </Badge>
                                    <Text size="sm" fw={600} truncate>
                                        {attachment.filename}
                                    </Text>
                                    <Text size="xs" c="gray.7">
                                        {formatBytes(attachment.sizeBytes)}
                                    </Text>
                                </Group>
                                <Group gap="xs" wrap="nowrap">
                                    {onAnalyze && attachment.kind === ANALYZABLE_KIND ? (
                                        <Button
                                            size="compact-xs"
                                            variant="light"
                                            loading={analyzing === attachment.id}
                                            data-testid={`attachment-analyze-${attachment.id}`}
                                            // Role-named drive target for tours (@app-config/tours):
                                            // the testid above carries a row id, which is a uuid on the
                                            // server and a seed index in the static twin, so a
                                            // walkthrough cannot name it. "The analyze button" it can.
                                            data-tour="analyze-bundle"
                                            onClick={() => {
                                                setAnalyzing(attachment.id)
                                                void onAnalyze(attachment.id).finally(() => setAnalyzing(null))
                                            }}
                                        >
                                            {t('analyzeButton')}
                                        </Button>
                                    ) : null}
                                    {attachment.downloadUrl ? (
                                        <Anchor
                                            href={attachment.downloadUrl}
                                            size="sm"
                                            download
                                            data-testid={`attachment-download-${attachment.id}`}
                                        >
                                            {t('download')}
                                        </Anchor>
                                    ) : null}
                                </Group>
                            </Group>
                        ))}
                    </Stack>
                )}

                {onAnalyze ? (
                    <Text size="xs" c="gray.7">
                        {t('analyzeHint')}
                    </Text>
                ) : null}

                {!canCreate ? (
                    <Text size="sm" c="gray.7" data-testid="attachments-readonly-hint">
                        {t('readOnlyHint')}
                    </Text>
                ) : null}
            </Stack>
        </Card>
    )
}
