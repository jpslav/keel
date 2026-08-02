'use client'

import { Badge, Button, Card, Code, Group, MultiSelect, Stack, Switch, Text, TextInput, Title } from '@mantine/core'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

export interface WebhookEndpointItem {
    id: string
    url: string
    eventKinds: string[]
    enabled: boolean
    createdAt: string
}

/**
 * Router-agnostic outbound-webhook endpoints card, the two-list card pattern: an org
 * admin lists, adds, enables/disables and removes egress endpoints for the active team. Presentational
 * only — the glue owns fetching + the authorize()-gated mutations. The shared secret is generated
 * server-side and shown ONCE, right after create (house-simple: it's not retrievable again); the card
 * surfaces it in a dismissible callout so the admin can copy it into their receiver.
 */
export function WebhookEndpointsCard({
    endpoints,
    eventKindOptions,
    newSecret,
    onCreate,
    onToggle,
    onDelete,
    onDismissSecret,
}: {
    endpoints: WebhookEndpointItem[]
    /** The registered event kinds an endpoint may subscribe to (packages/keel/src/core/webhook-events.ts). */
    eventKindOptions: string[]
    /** Set once immediately after a create — the plaintext secret to show exactly once. */
    newSecret: string | null
    onCreate: (input: { url: string; eventKinds: string[] }) => Promise<void>
    onToggle: (id: string, enabled: boolean) => Promise<void>
    onDelete: (id: string) => Promise<void>
    onDismissSecret: () => void
}) {
    const t = useTranslations('webhooks')
    const [url, setUrl] = useState('')
    const [kinds, setKinds] = useState<string[]>([])
    const [busy, setBusy] = useState(false)

    return (
        <Card withBorder padding="lg" radius="md" data-testid="webhook-endpoints-card">
            <Stack gap="md">
                <Title order={2} size="h3">
                    {t('cardTitle')}
                </Title>
                <Text size="sm" c="gray.7">
                    {t('cardDescription')}
                </Text>

                {newSecret ? (
                    <Card withBorder padding="md" radius="sm" bg="yellow.0" data-testid="webhook-new-secret">
                        <Stack gap="xs">
                            <Text size="sm" fw={600}>
                                {t('secretHeading')}
                            </Text>
                            <Text size="xs" c="gray.7">
                                {t('secretOnce')}
                            </Text>
                            <Code data-testid="webhook-new-secret-value">{newSecret}</Code>
                            <Button
                                variant="default"
                                size="xs"
                                data-testid="webhook-secret-dismiss"
                                style={{ alignSelf: 'flex-start' }}
                                onClick={onDismissSecret}
                            >
                                {t('secretDismiss')}
                            </Button>
                        </Stack>
                    </Card>
                ) : null}

                {endpoints.length === 0 ? (
                    <Text size="sm" c="gray.7" data-testid="webhook-endpoints-empty">
                        {t('endpointsEmpty')}
                    </Text>
                ) : (
                    <Stack gap="xs" data-testid="webhook-endpoints-list">
                        {endpoints.map((endpoint) => (
                            <Group
                                key={endpoint.id}
                                justify="space-between"
                                wrap="nowrap"
                                data-testid={`webhook-endpoint-${endpoint.id}`}
                            >
                                <Stack gap={2} style={{ minWidth: 0 }}>
                                    <Text size="sm" fw={600} truncate>
                                        {endpoint.url}
                                    </Text>
                                    <Group gap={4} wrap="wrap">
                                        {endpoint.eventKinds.map((kind) => (
                                            <Badge key={kind} variant="light" radius="sm" color="blue">
                                                {kind}
                                            </Badge>
                                        ))}
                                    </Group>
                                </Stack>
                                <Group gap="sm" wrap="nowrap">
                                    <Switch
                                        checked={endpoint.enabled}
                                        aria-label={t('toggleAriaLabel')}
                                        data-testid={`webhook-endpoint-toggle-${endpoint.id}`}
                                        disabled={busy}
                                        onChange={(event) => {
                                            setBusy(true)
                                            void onToggle(endpoint.id, event.currentTarget.checked).finally(() =>
                                                setBusy(false),
                                            )
                                        }}
                                    />
                                    <Button
                                        size="xs"
                                        variant="default"
                                        color="red"
                                        disabled={busy}
                                        data-testid={`webhook-endpoint-delete-${endpoint.id}`}
                                        onClick={() => {
                                            setBusy(true)
                                            void onDelete(endpoint.id).finally(() => setBusy(false))
                                        }}
                                    >
                                        {t('deleteButton')}
                                    </Button>
                                </Group>
                            </Group>
                        ))}
                    </Stack>
                )}

                <Stack gap="xs">
                    <TextInput
                        label={t('urlLabel')}
                        placeholder={t('urlPlaceholder')}
                        value={url}
                        data-testid="webhook-url"
                        onChange={(event) => setUrl(event.currentTarget.value)}
                    />
                    <MultiSelect
                        label={t('eventKindsLabel')}
                        data={eventKindOptions.map((kind) => ({ value: kind, label: kind }))}
                        value={kinds}
                        data-testid="webhook-event-kinds"
                        onChange={setKinds}
                    />
                    <Button
                        loading={busy}
                        disabled={!url.trim() || kinds.length === 0}
                        data-testid="webhook-create"
                        style={{ alignSelf: 'flex-start' }}
                        onClick={() => {
                            setBusy(true)
                            onCreate({ url: url.trim(), eventKinds: kinds })
                                .then(() => {
                                    setUrl('')
                                    setKinds([])
                                })
                                .finally(() => setBusy(false))
                        }}
                    >
                        {t('createButton')}
                    </Button>
                </Stack>
            </Stack>
        </Card>
    )
}
