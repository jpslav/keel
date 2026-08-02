'use client'

import { Badge, Button, Card, Group, Select, Stack, Text, Textarea, TextInput, Title } from '@mantine/core'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

/** One escalation as either party sees it. Direction is decided by which list it's in. */
export interface EscalationItem {
    id: string
    subject: string
    body: string
    status: string
    requesterOrgName: string
    responderOrgName: string
    createdAt: string
}

/** A team this desk may escalate to (the tenant's other teams). */
export interface EscalationTarget {
    slug: string
    name: string
}

const STATUS_KEY: Record<string, string> = {
    open: 'statusOpen',
    accepted: 'statusAccepted',
    rejected: 'statusRejected',
    cancelled: 'statusCancelled',
}

// Only hues whose `light` variant clears WCAG AA at this small bold size (the OrgScreen palette:
// green/red/teal fail contrast here, so status is distinguished by these AA-safe hues + the label
// text, never by colour alone). axe (a11y.spec) enforces this.
const STATUS_COLOR: Record<string, string> = {
    open: 'blue',
    accepted: 'indigo',
    rejected: 'grape',
    cancelled: 'gray',
}

/**
 * Router-agnostic escalations card. An escalation is TWO-SIDED: the same row shows in the
 * requester's "sent" list and the responder's "received" list. The requester may withdraw an open
 * escalation (Cancel); the responder may Accept/Reject an open one — but only when they're an org manager,
 * which the caller reflects via `canRespond`. Presentational only: the glue does the fetching.
 */
export function EscalationsCard({
    sent,
    received,
    targets,
    canCreate,
    canRespond,
    onCreate,
    onRespond,
    onCancel,
}: {
    sent: EscalationItem[]
    received: EscalationItem[]
    targets: EscalationTarget[]
    /** Requester-side create/withdraw affordance (non-restricted member). */
    canCreate: boolean
    /** Responder-side accept/reject affordance (org manager). */
    canRespond: boolean
    onCreate: (input: { responderOrgSlug: string; subject: string; body: string }) => Promise<void>
    onRespond: (id: string, decision: 'accept' | 'reject') => Promise<void>
    onCancel: (id: string) => Promise<void>
}) {
    const t = useTranslations('escalations')
    const [target, setTarget] = useState<string | null>(null)
    const [subject, setSubject] = useState('')
    const [body, setBody] = useState('')
    const [busy, setBusy] = useState(false)

    function StatusBadge({ status }: { status: string }) {
        return (
            <Badge color={STATUS_COLOR[status] ?? 'gray'} variant="light" radius="sm">
                {t(STATUS_KEY[status] ?? 'statusOpen')}
            </Badge>
        )
    }

    return (
        <Card withBorder padding="lg" radius="md" data-testid="escalations-card">
            <Stack gap="md">
                <Title order={2} size="h3">
                    {t('title')}
                </Title>

                {/* Requests my team sent */}
                <Stack gap="xs">
                    <Title order={3} size="h4">
                        {t('sentHeading')}
                    </Title>
                    {sent.length === 0 ? (
                        <Text size="sm" c="gray.7" data-testid="escalations-sent-empty">
                            {t('sentEmpty')}
                        </Text>
                    ) : (
                        <Stack gap="xs" data-testid="escalations-sent-list">
                            {sent.map((escalation) => (
                                <Group
                                    key={escalation.id}
                                    justify="space-between"
                                    wrap="nowrap"
                                    data-testid={`escalation-sent-${escalation.id}`}
                                >
                                    <Stack gap={2}>
                                        <Text size="sm" fw={600}>
                                            {escalation.subject}
                                        </Text>
                                        <Text size="xs" c="gray.7">
                                            {t('toLabel', { org: escalation.responderOrgName })}
                                        </Text>
                                    </Stack>
                                    <Group gap="xs" wrap="nowrap">
                                        <span data-testid={`escalation-status-${escalation.id}`}>
                                            <StatusBadge status={escalation.status} />
                                        </span>
                                        {escalation.status === 'open' && canCreate ? (
                                            <Button
                                                size="xs"
                                                variant="default"
                                                disabled={busy}
                                                data-testid={`escalation-cancel-${escalation.id}`}
                                                onClick={() => {
                                                    setBusy(true)
                                                    void onCancel(escalation.id).finally(() => setBusy(false))
                                                }}
                                            >
                                                {t('cancelButton')}
                                            </Button>
                                        ) : null}
                                    </Group>
                                </Group>
                            ))}
                        </Stack>
                    )}
                </Stack>

                {/* Requests to my team */}
                <Stack gap="xs">
                    <Title order={3} size="h4">
                        {t('receivedHeading')}
                    </Title>
                    {received.length === 0 ? (
                        <Text size="sm" c="gray.7" data-testid="escalations-received-empty">
                            {t('receivedEmpty')}
                        </Text>
                    ) : (
                        <Stack gap="xs" data-testid="escalations-received-list">
                            {received.map((escalation) => (
                                <Group
                                    key={escalation.id}
                                    justify="space-between"
                                    wrap="nowrap"
                                    data-testid={`escalation-received-${escalation.id}`}
                                >
                                    <Stack gap={2}>
                                        <Text size="sm" fw={600}>
                                            {escalation.subject}
                                        </Text>
                                        <Text size="xs" c="gray.7">
                                            {t('fromLabel', { org: escalation.requesterOrgName })}
                                        </Text>
                                    </Stack>
                                    <Group gap="xs" wrap="nowrap">
                                        <span data-testid={`escalation-status-${escalation.id}`}>
                                            <StatusBadge status={escalation.status} />
                                        </span>
                                        {escalation.status === 'open' && canRespond ? (
                                            <>
                                                <Button
                                                    size="xs"
                                                    disabled={busy}
                                                    data-testid={`escalation-accept-${escalation.id}`}
                                                    // Role-named drive target for tours: the testid
                                                    // above carries a row id (a uuid on the server, a
                                                    // seed index in the static twin), so a walkthrough
                                                    // names the ROLE instead — the first decidable
                                                    // escalation on screen.
                                                    data-tour="escalation-accept"
                                                    onClick={() => {
                                                        setBusy(true)
                                                        void onRespond(escalation.id, 'accept').finally(() =>
                                                            setBusy(false),
                                                        )
                                                    }}
                                                >
                                                    {t('acceptButton')}
                                                </Button>
                                                <Button
                                                    size="xs"
                                                    variant="default"
                                                    disabled={busy}
                                                    data-testid={`escalation-reject-${escalation.id}`}
                                                    onClick={() => {
                                                        setBusy(true)
                                                        void onRespond(escalation.id, 'reject').finally(() =>
                                                            setBusy(false),
                                                        )
                                                    }}
                                                >
                                                    {t('rejectButton')}
                                                </Button>
                                            </>
                                        ) : null}
                                    </Group>
                                </Group>
                            ))}
                        </Stack>
                    )}
                </Stack>

                {/* Raise a new escalation — requester-side, and only when there's another team to address. */}
                {canCreate && targets.length > 0 ? (
                    <Stack gap="xs">
                        <Select
                            label={t('targetLabel')}
                            data={targets.map((org) => ({ value: org.slug, label: org.name }))}
                            value={target}
                            allowDeselect={false}
                            data-testid="escalation-target"
                            onChange={setTarget}
                        />
                        <TextInput
                            label={t('subjectLabel')}
                            value={subject}
                            data-testid="escalation-subject"
                            onChange={(event) => setSubject(event.currentTarget.value)}
                        />
                        <Textarea
                            label={t('bodyLabel')}
                            value={body}
                            autosize
                            minRows={2}
                            data-testid="escalation-body"
                            onChange={(event) => setBody(event.currentTarget.value)}
                        />
                        <Button
                            loading={busy}
                            disabled={!target || !subject.trim() || !body.trim()}
                            data-testid="escalation-create"
                            style={{ alignSelf: 'flex-start' }}
                            onClick={() => {
                                if (!target) return
                                setBusy(true)
                                onCreate({ responderOrgSlug: target, subject: subject.trim(), body: body.trim() })
                                    .then(() => {
                                        setTarget(null)
                                        setSubject('')
                                        setBody('')
                                    })
                                    .finally(() => setBusy(false))
                            }}
                        >
                            {t('createButton')}
                        </Button>
                    </Stack>
                ) : null}

                {!canCreate ? (
                    <Text size="sm" c="gray.7" data-testid="escalations-readonly-hint">
                        {t('readOnlyHint')}
                    </Text>
                ) : null}
            </Stack>
        </Card>
    )
}
