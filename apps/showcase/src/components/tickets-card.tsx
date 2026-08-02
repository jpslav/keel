'use client'

import { Badge, Button, Card, Group, Select, Stack, Text, TextInput, Textarea, Title } from '@mantine/core'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { TICKET_SLA_HOURS, TICKET_STATUSES, type TicketStatus, isSlaBreached } from '@/domain/tickets'

/** One ticket as its team sees it in the queue. */
export interface TicketItem {
    id: string
    ref: string
    subject: string
    body: string
    status: TicketStatus
    assigneeUserId: string | null
    createdAt: string
}

/** Someone the ticket can be handed to — the active team's members, resolved by the caller. */
export interface TicketAssignee {
    id: string
    name: string
}

const STATUS_KEY: Record<TicketStatus, string> = {
    open: 'statusOpen',
    pending: 'statusPending',
    resolved: 'statusResolved',
}

// NOT a per-status colour: Mantine's `light` badge variants for yellow and green fall below the WCAG
// AA contrast floor on white, and the status is already spelled out in the picker beside the row. The
// reference is rendered as plain emphasised text for the same reason.

/**
 * The desk's queue — the user-visible face of row-level security AND of the ability model. Whatever is
 * written here exists only inside the active tenant (the cross-tenant e2e proof drives this card), and
 * only inside the active team.
 *
 * Every ability rule the app registers for `Ticket` has a control here: create (the form), update (the
 * status and assignee pickers), delete (the button). Restricted members see the queue read-only — the
 * same pure ability model the server enforces decides, so the UI can never offer what the route would
 * refuse.
 *
 * `slaHighlight` comes from the app-registered `sla-breach-banner` Simulator flag: flipping it in
 * Snapshots changes what the PRODUCT shows (a banner and per-row badges), not just what the panel says.
 */
export function TicketsCard({
    tickets,
    assignees,
    canWrite = true,
    slaHighlight = false,
    nowMs,
    hasMore = false,
    onLoadMore,
    onCreate,
    onUpdate,
    onDelete,
}: {
    tickets: TicketItem[]
    assignees: TicketAssignee[]
    /** When false (restricted members), every control is disabled and a read-only hint shows. */
    canWrite?: boolean
    /** Flag-gated: highlight tickets that have been open longer than the desk's SLA. */
    slaHighlight?: boolean
    /** The clock, as a render INPUT. The wall clock is not a render input — reading it during render
     *  is impure and can make the same tickets render "late" or not depending on when React happens to
     *  re-render — so the caller reads it once and passes it down. */
    nowMs?: number
    /** True while the queue has a next page. The CALLER owns the cursor — the card never sees one,
     *  which is what keeps it a plain list rather than a data-fetching component. */
    hasMore?: boolean
    /** Appends the next page. Absent = this list does not page (the read-only/static callers). */
    onLoadMore?: () => Promise<void>
    onCreate: (input: { subject: string; body: string }) => Promise<void>
    onUpdate: (id: string, changes: { status?: TicketStatus; assigneeUserId?: string | null }) => Promise<void>
    onDelete: (id: string) => Promise<void>
}) {
    const t = useTranslations('tickets')
    // Lazily read ONCE if the caller did not supply a clock, never on every render.
    const [fallbackNow] = useState(() => Date.now())
    const clock = nowMs ?? fallbackNow
    const [subject, setSubject] = useState('')
    const [body, setBody] = useState('')
    const [busy, setBusy] = useState(false)
    const [loadingMore, setLoadingMore] = useState(false)

    const assigneeOptions = [
        { value: '', label: t('unassigned') },
        ...assignees.map((a) => ({ value: a.id, label: a.name })),
    ]
    const statusOptions = TICKET_STATUSES.map((s) => ({ value: s, label: t(STATUS_KEY[s]) }))
    const lateCount = tickets.filter((ticket) => isSlaBreached(ticket.status, ticket.createdAt, clock)).length

    return (
        <Card withBorder padding="lg" radius="md" data-testid="tickets-card">
            <Stack gap="sm">
                <Title order={2} size="h3">
                    {t('title')}
                </Title>
                <Text size="sm" c="gray.7">
                    {t('hint')}
                </Text>

                {slaHighlight && lateCount > 0 ? (
                    <Text size="sm" c="red.7" fw={600} data-testid="tickets-sla-banner">
                        {t('slaBanner', { count: lateCount, hours: TICKET_SLA_HOURS })}
                    </Text>
                ) : null}

                {tickets.length === 0 ? (
                    <Text c="gray.7" data-testid="tickets-empty">
                        {t('empty')}
                    </Text>
                ) : (
                    <Stack gap="xs" data-testid="tickets-list">
                        {tickets.map((ticket) => {
                            const late = slaHighlight && isSlaBreached(ticket.status, ticket.createdAt, clock)
                            return (
                                <Stack
                                    key={ticket.id}
                                    gap={4}
                                    data-testid="ticket-item"
                                    data-ref={ticket.ref}
                                    style={{
                                        borderTop: '1px solid var(--mantine-color-gray-2)',
                                        paddingTop: 'var(--mantine-spacing-xs)',
                                    }}
                                >
                                    <Group gap="xs" wrap="nowrap">
                                        <Text size="sm" fw={700} c="gray.8">
                                            {ticket.ref}
                                        </Text>
                                        <Text size="sm" fw={600} style={{ flex: 1, minWidth: 0 }}>
                                            {ticket.subject}
                                        </Text>
                                        {late ? (
                                            <Badge color="red" variant="filled" radius="sm" data-testid="ticket-late">
                                                {t('slaBadge')}
                                            </Badge>
                                        ) : null}
                                    </Group>
                                    <Group gap="xs" align="end" wrap="wrap">
                                        <Select
                                            size="xs"
                                            label={t('statusLabel')}
                                            data={statusOptions}
                                            value={ticket.status}
                                            disabled={!canWrite}
                                            allowDeselect={false}
                                            data-testid={`ticket-status-${ticket.ref}`}
                                            onChange={(value) => {
                                                if (!value || value === ticket.status) return
                                                void onUpdate(ticket.id, { status: value as TicketStatus })
                                            }}
                                        />
                                        <Select
                                            size="xs"
                                            label={t('assigneeLabel')}
                                            data={assigneeOptions}
                                            value={ticket.assigneeUserId ?? ''}
                                            disabled={!canWrite}
                                            allowDeselect={false}
                                            data-testid={`ticket-assignee-${ticket.ref}`}
                                            onChange={(value) => {
                                                const next = value === '' ? null : value
                                                if (next === ticket.assigneeUserId) return
                                                void onUpdate(ticket.id, { assigneeUserId: next })
                                            }}
                                        />
                                        <Button
                                            size="compact-xs"
                                            variant="subtle"
                                            color="red"
                                            disabled={!canWrite}
                                            data-testid={`ticket-delete-${ticket.ref}`}
                                            onClick={() => void onDelete(ticket.id)}
                                        >
                                            {t('deleteButton')}
                                        </Button>
                                    </Group>
                                </Stack>
                            )
                        })}
                    </Stack>
                )}

                {/* The queue is paged (keel/db/keyset): this appends the next page rather than
                    replacing the list, so what the reader has already scrolled past stays put. */}
                {hasMore && onLoadMore ? (
                    <Button
                        size="compact-sm"
                        variant="default"
                        loading={loadingMore}
                        data-testid="tickets-load-more"
                        style={{ alignSelf: 'flex-start' }}
                        onClick={() => {
                            setLoadingMore(true)
                            onLoadMore().finally(() => setLoadingMore(false))
                        }}
                    >
                        {t('loadMore')}
                    </Button>
                ) : null}

                <TextInput
                    label={t('newSubjectLabel')}
                    value={subject}
                    disabled={!canWrite}
                    data-testid="ticket-input"
                    onChange={(event) => setSubject(event.currentTarget.value)}
                />
                <Textarea
                    label={t('newBodyLabel')}
                    value={body}
                    autosize
                    minRows={2}
                    disabled={!canWrite}
                    data-testid="ticket-body-input"
                    onChange={(event) => setBody(event.currentTarget.value)}
                />
                <Button
                    loading={busy}
                    disabled={!canWrite || !subject.trim()}
                    data-testid="ticket-add"
                    style={{ alignSelf: 'flex-start' }}
                    onClick={() => {
                        setBusy(true)
                        onCreate({ subject: subject.trim(), body: body.trim() })
                            .then(() => {
                                setSubject('')
                                setBody('')
                            })
                            .finally(() => setBusy(false))
                    }}
                >
                    {t('addButton')}
                </Button>

                {!canWrite ? (
                    <Text size="sm" c="gray.7" data-testid="tickets-readonly-hint">
                        {t('readOnlyHint')}
                    </Text>
                ) : null}
            </Stack>
        </Card>
    )
}
