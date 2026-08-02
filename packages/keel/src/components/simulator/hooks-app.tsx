'use client'

import { Box, Group, Stack, Text, UnstyledButton } from '@mantine/core'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { chipStyle } from './people-app'
import { formatWhen } from './format-when'

/** One endpoint as the Hooks tab renders it (local shape, decoupled from packages/keel/src/db's WorldEndpoint). */
export interface HookEndpointRow {
    id: string
    url: string
    eventKinds: string[]
    enabled: boolean
    tenantSlug: string
    orgSlug: string
}

/** One delivery + the caught signed body/header (local shape, decoupled from packages/keel/src/db's WorldDelivery). */
export interface HookDeliveryRow {
    id: string
    endpointUrl: string
    eventKind: string
    status: string
    attemptCount: number
    nextAttemptAt: string
    lastError: string | null
    createdAt: string
    deliveredAt: string | null
    tenantSlug: string
    orgSlug: string
    signature: string | null
    body: string | null
}

const runButtonStyle = {
    fontSize: 12,
    fontWeight: 600,
    color: '#f8f9fa',
    border: '1px solid #373a40',
    borderRadius: 6,
    padding: '4px 10px',
} as const

const sectionStyle = {
    border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: 8,
    padding: 10,
} as const

/** Colour cue per delivery status — presentational only; the chip label stays the raw enum. */
function statusColor(status: string): string {
    switch (status) {
        case 'delivered':
            return 'teal.4'
        case 'failed':
            return 'yellow.4'
        case 'dead':
            return 'red.4'
        default:
            return 'gray.4'
    }
}

function Endpoints({
    endpoints,
    failingEndpointIds,
    onToggleFail,
}: {
    endpoints: HookEndpointRow[]
    failingEndpointIds: string[]
    onToggleFail: (endpointId: string, failing: boolean) => void | Promise<void>
}) {
    const t = useTranslations('webhooks')
    const failing = new Set(failingEndpointIds)
    const [busy, setBusy] = useState(false)

    const run = (action: () => void | Promise<void>) => {
        setBusy(true)
        void Promise.resolve(action()).finally(() => setBusy(false))
    }

    return (
        <Box style={sectionStyle} data-testid="simulator-hook-endpoints">
            <Text size="xs" fw={700} c="gray.0" mb={6}>
                {t('simulatorEndpointsTitle')}
            </Text>
            {endpoints.length === 0 ? (
                <Text size="xs" c="gray.5" data-testid="simulator-hook-endpoints-empty">
                    {t('simulatorEndpointsEmpty')}
                </Text>
            ) : (
                <Stack gap={6}>
                    {endpoints.map((endpoint) => {
                        const isFailing = failing.has(endpoint.id)
                        return (
                            <Box
                                key={endpoint.id}
                                data-testid={`simulator-hook-endpoint-${endpoint.id}`}
                                style={{
                                    border: '1px solid rgba(255,255,255,0.12)',
                                    borderRadius: 6,
                                    padding: '6px 8px',
                                }}
                            >
                                <Group justify="space-between" wrap="nowrap" gap="xs" align="start">
                                    <Stack gap={2} style={{ minWidth: 0 }}>
                                        <Text size="sm" fw={600} c="gray.0" truncate>
                                            {endpoint.url}
                                        </Text>
                                        <Text size="xs" c="gray.4" truncate>
                                            {endpoint.eventKinds.join(', ')}
                                        </Text>
                                        <Group gap={4} wrap="wrap">
                                            <Text size="xs" c="gray.3" style={chipStyle}>
                                                {endpoint.tenantSlug}
                                            </Text>
                                            <Text size="xs" c="gray.3" style={chipStyle}>
                                                {endpoint.orgSlug}
                                            </Text>
                                            <Text
                                                size="xs"
                                                fw={700}
                                                c={endpoint.enabled ? 'teal.4' : 'gray.5'}
                                                style={chipStyle}
                                            >
                                                {endpoint.enabled ? t('enabled') : t('disabled')}
                                            </Text>
                                        </Group>
                                    </Stack>
                                    <UnstyledButton
                                        data-testid={`simulator-hook-fail-${endpoint.id}`}
                                        disabled={busy}
                                        onClick={() => run(() => onToggleFail(endpoint.id, !isFailing))}
                                        style={{
                                            ...runButtonStyle,
                                            flexShrink: 0,
                                            opacity: busy ? 0.6 : 1,
                                            color: isFailing ? '#ffd43b' : '#f8f9fa',
                                        }}
                                    >
                                        {isFailing ? t('simulatorRecover') : t('simulatorFail')}
                                    </UnstyledButton>
                                </Group>
                            </Box>
                        )
                    })}
                </Stack>
            )}
        </Box>
    )
}

function Deliveries({ deliveries }: { deliveries: HookDeliveryRow[] }) {
    const t = useTranslations('webhooks')
    const locale = useLocale()
    const [openId, setOpenId] = useState<string | null>(null)

    return (
        <Box style={sectionStyle} data-testid="simulator-hook-deliveries">
            <Text size="xs" fw={700} c="gray.0" mb={6}>
                {t('simulatorDeliveriesTitle')}
            </Text>
            {deliveries.length === 0 ? (
                <Text size="xs" c="gray.5" data-testid="simulator-hook-deliveries-empty">
                    {t('simulatorDeliveriesEmpty')}
                </Text>
            ) : (
                <Stack gap={6}>
                    {deliveries.map((delivery) => {
                        const open = delivery.id === openId
                        return (
                            <Box
                                key={delivery.id}
                                data-testid={`simulator-hook-delivery-${delivery.id}`}
                                style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6 }}
                            >
                                <UnstyledButton
                                    data-testid={`simulator-hook-delivery-toggle-${delivery.id}`}
                                    aria-expanded={open}
                                    onClick={() => setOpenId(open ? null : delivery.id)}
                                    style={{ display: 'block', width: '100%', padding: '6px 8px' }}
                                >
                                    <Group justify="space-between" wrap="nowrap" gap="xs" align="start">
                                        <Stack gap={2} style={{ minWidth: 0 }}>
                                            <Text size="sm" fw={600} c="gray.0" truncate>
                                                {delivery.eventKind}
                                            </Text>
                                            <Text size="xs" c="gray.4" truncate>
                                                {delivery.endpointUrl}
                                            </Text>
                                        </Stack>
                                        <Stack gap={2} align="end" style={{ flexShrink: 0 }}>
                                            <Text
                                                size="xs"
                                                fw={700}
                                                c={statusColor(delivery.status)}
                                                style={chipStyle}
                                                data-testid={`simulator-hook-delivery-status-${delivery.id}`}
                                            >
                                                {delivery.status}
                                            </Text>
                                            <Text
                                                size="xs"
                                                c="gray.5"
                                                style={{ whiteSpace: 'nowrap' }}
                                                data-testid={`simulator-hook-delivery-attempts-${delivery.id}`}
                                            >
                                                {t('simulatorAttempts', { count: delivery.attemptCount })}
                                            </Text>
                                        </Stack>
                                    </Group>
                                </UnstyledButton>
                                {open ? (
                                    <Box px={8} pb="xs" style={{ color: '#f8f9fa' }}>
                                        <Text size="xs" c="gray.5">
                                            {t('simulatorNextRetry', {
                                                when: formatWhen(delivery.nextAttemptAt, locale),
                                            })}
                                        </Text>
                                        {delivery.lastError ? (
                                            <Text
                                                size="xs"
                                                c="red.4"
                                                data-testid={`simulator-hook-delivery-error-${delivery.id}`}
                                            >
                                                {delivery.lastError}
                                            </Text>
                                        ) : null}
                                        {delivery.signature ? (
                                            <>
                                                <Text size="xs" fw={700} c="gray.3" mt={4}>
                                                    {t('simulatorSignature')}
                                                </Text>
                                                <Text
                                                    size="xs"
                                                    c="gray.4"
                                                    data-testid={`simulator-hook-delivery-signature-${delivery.id}`}
                                                    style={{ wordBreak: 'break-all', fontFamily: 'monospace' }}
                                                >
                                                    {delivery.signature}
                                                </Text>
                                            </>
                                        ) : null}
                                        {delivery.body ? (
                                            <>
                                                <Text size="xs" fw={700} c="gray.3" mt={4}>
                                                    {t('simulatorBody')}
                                                </Text>
                                                <Text
                                                    size="xs"
                                                    c="gray.4"
                                                    component="pre"
                                                    data-testid={`simulator-hook-delivery-body-${delivery.id}`}
                                                    style={{
                                                        whiteSpace: 'pre-wrap',
                                                        wordBreak: 'break-all',
                                                        fontFamily: 'monospace',
                                                        margin: 0,
                                                    }}
                                                >
                                                    {delivery.body}
                                                </Text>
                                            </>
                                        ) : null}
                                    </Box>
                                ) : null}
                            </Box>
                        )
                    })}
                </Stack>
            )}
        </Box>
    )
}

/**
 * Router-agnostic Simulator Hooks tab (ADR-0006 twin lives in keel/demo-static): the simulated world's
 * outbound-webhook surface. Shows every endpoint (with a per-endpoint failure toggle that
 * drives the fake dispatch) and every delivery (status, attempts, next retry, and the caught signed
 * body + signature header, inspectable), plus a "deliver due now" button. Dark-skinned to match
 * the other world tabs; presentational only — the host owns fetching and the mutations.
 */
export function HooksApp({
    endpoints,
    deliveries,
    failingEndpointIds,
    onToggleFail,
    onRunDue,
}: {
    endpoints: HookEndpointRow[]
    deliveries: HookDeliveryRow[]
    failingEndpointIds: string[]
    onToggleFail: (endpointId: string, failing: boolean) => void | Promise<void>
    onRunDue: () => void | Promise<void>
}) {
    const t = useTranslations('webhooks')
    const [busy, setBusy] = useState(false)

    return (
        <Stack gap="sm" data-testid="simulator-hooks">
            <Group justify="flex-end">
                <UnstyledButton
                    data-testid="simulator-hooks-run-due"
                    disabled={busy}
                    onClick={() => {
                        setBusy(true)
                        void Promise.resolve(onRunDue()).finally(() => setBusy(false))
                    }}
                    style={{ ...runButtonStyle, opacity: busy ? 0.6 : 1 }}
                >
                    {t('simulatorRunDue')}
                </UnstyledButton>
            </Group>
            <Endpoints endpoints={endpoints} failingEndpointIds={failingEndpointIds} onToggleFail={onToggleFail} />
            <Deliveries deliveries={deliveries} />
        </Stack>
    )
}
