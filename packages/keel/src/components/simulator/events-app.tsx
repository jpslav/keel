'use client'

import { Box, Divider, Group, Stack, Text, UnstyledButton } from '@mantine/core'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { formatTimeShort, formatWhen } from './format-when'

export interface AnalyticsEvent {
    id: string
    at: string
    event: string
    properties?: Record<string, unknown>
}

/**
 * One compliance-grade audit event — the durable "who did what when" product record, distinct
 * from the analytics events above it. In the real app these arrive from GET /api/simulator/audit (the
 * cross-tenant god view of the audit_events table); the static twin appends them in memory from its own
 * mutations. tenantSlug/orgSlug are present in the god view (cross-tenant) and in the twin.
 */
export interface AuditEntry {
    id: string
    at: string
    action: string
    subjectType: string
    subjectId: string | null
    actorUserId: string
    tenantSlug?: string
    orgSlug?: string | null
}

/** A dark-skin expandable row shared by both sections (analytics events + audit). */
function LogRow({
    id,
    title,
    hint,
    at,
    open,
    onToggle,
    detail,
    glyph,
    testidPrefix,
}: {
    id: string
    title: string
    hint: string | null
    at: string
    open: boolean
    onToggle: () => void
    detail: unknown
    glyph: string
    testidPrefix: string
}) {
    const locale = useLocale()
    return (
        <Box data-testid={`${testidPrefix}-${id}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
            <UnstyledButton
                data-testid={`${testidPrefix}-toggle-${id}`}
                aria-expanded={open}
                onClick={onToggle}
                style={{ display: 'block', width: '100%', padding: '8px 4px' }}
            >
                <Group gap={8} wrap="nowrap" align="center">
                    <Text
                        size="xs"
                        c="gray.5"
                        aria-hidden
                        style={{
                            flexShrink: 0,
                            display: 'inline-block',
                            transform: open ? 'rotate(90deg)' : 'none',
                            transition: 'transform 120ms',
                        }}
                    >
                        {glyph}
                    </Text>
                    <Text size="sm" fw={600} c="gray.0" truncate style={{ minWidth: 0 }}>
                        {title}
                    </Text>
                    {hint ? (
                        <Text size="xs" c="gray.5" truncate style={{ minWidth: 0, flex: 1 }}>
                            {hint}
                        </Text>
                    ) : (
                        <span style={{ flex: 1 }} />
                    )}
                    <Text size="xs" c="gray.5" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                        {formatTimeShort(at, locale)}
                    </Text>
                </Group>
            </UnstyledButton>
            {open ? (
                <Stack gap={6} pb="xs" px={4}>
                    <Text size="xs" c="gray.5">
                        {formatWhen(at, locale)}
                    </Text>
                    <Box
                        component="pre"
                        style={{
                            fontFamily: 'monospace',
                            fontSize: 11,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            background: 'rgba(255,255,255,0.06)',
                            borderRadius: 6,
                            padding: 8,
                            color: '#f8f9fa',
                            margin: 0,
                        }}
                    >
                        {JSON.stringify(detail, null, 2)}
                    </Box>
                </Stack>
            ) : null}
        </Box>
    )
}

/** Simulator Events tab (ADR-0010): TWO stacked read-only sections — the fake analytics adapter's
 *  event log (dev telemetry, observation only), and below a labeled divider the durable audit trail,
 *  the compliance-grade product record. Keeping audit here rather than in an eighth tab
 *  respects the events-are-observations doctrine while making clear these are different KINDS of record.
 *  Compact dark-skin rows that expand to the full timestamp + details (this screen renders only inside
 *  the Simulator <aside>, so it shares the panel's dark palette rather than a light box). */
export function EventsApp({ events, audit = [] }: { events: AnalyticsEvent[]; audit?: AuditEntry[] }) {
    const t = useTranslations('events')
    const [openEventId, setOpenEventId] = useState<string | null>(null)
    const [openAuditId, setOpenAuditId] = useState<string | null>(null)

    return (
        // No landmark: this screen renders only inside the Simulator <aside>, never as a page.
        <Stack gap="md">
            <Stack gap={4}>
                <Text size="xs" fw={700} c="gray.4" tt="uppercase" data-testid="events-heading">
                    {t('analyticsHeading')}
                </Text>
                {events.length === 0 ? (
                    <Text size="sm" c="gray.5" data-testid="events-empty">
                        {t('empty')}
                    </Text>
                ) : (
                    <Stack gap={0} data-testid="events-list">
                        {events.map((event) => {
                            // The one-line hint prefers a page path, then a tenant slug — either identifies
                            // the event at a glance. Only strings qualify (properties is loose).
                            const path = event.properties?.path
                            const tenant = event.properties?.tenant
                            const hint = typeof path === 'string' ? path : typeof tenant === 'string' ? tenant : null
                            return (
                                <LogRow
                                    key={event.id}
                                    id={event.id}
                                    testidPrefix="event"
                                    title={event.event}
                                    hint={hint}
                                    at={event.at}
                                    open={event.id === openEventId}
                                    onToggle={() => setOpenEventId(event.id === openEventId ? null : event.id)}
                                    detail={event.properties ?? {}}
                                    glyph={t('toggleGlyph')}
                                />
                            )
                        })}
                    </Stack>
                )}
            </Stack>

            <Divider label={t('auditHeading')} labelPosition="left" color="dark.4" data-testid="audit-divider" />

            {audit.length === 0 ? (
                <Text size="sm" c="gray.5" data-testid="audit-empty">
                    {t('auditEmpty')}
                </Text>
            ) : (
                <Stack gap={0} data-testid="audit-list">
                    {audit.map((entry) => {
                        // Cross-tenant god view: the org (then tenant) slug identifies the record at a glance.
                        const hint = entry.orgSlug ?? entry.tenantSlug ?? null
                        return (
                            <LogRow
                                key={entry.id}
                                id={entry.id}
                                testidPrefix="audit"
                                title={entry.action}
                                hint={hint}
                                at={entry.at}
                                open={entry.id === openAuditId}
                                onToggle={() => setOpenAuditId(entry.id === openAuditId ? null : entry.id)}
                                detail={{
                                    subjectType: entry.subjectType,
                                    subjectId: entry.subjectId,
                                    actorUserId: entry.actorUserId,
                                    tenant: entry.tenantSlug ?? null,
                                    org: entry.orgSlug ?? null,
                                }}
                                glyph={t('toggleGlyph')}
                            />
                        )
                    })}
                </Stack>
            )}
        </Stack>
    )
}
