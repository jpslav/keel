'use client'

import { Badge, Box, Group, Stack, Text } from '@mantine/core'
import { useLocale, useTranslations } from 'next-intl'
import { formatWhen } from './format-when'

/** One caught SMS as the tab sees it — local row type, decoupled from the fake adapter's CaughtSms
 *  (the hooks-app HookDeliveryRow precedent), so the twin can produce it with no server types. */
export interface SmsMessageRow {
    id: string
    to: string
    body: string
    kind: string
    at: string
}

/**
 * Router-agnostic Simulator Messages tab — the fake SMS channel's catch-store surfaced as a
 * world view, the second consumer that keeps the notification channel abstraction honest. Display-only
 * (no clear control — Snapshots reset wipes `.data/sms/`): data + nothing else. The ADR-0006 twin in
 * keel/demo-static renders the same component over in-memory rows.
 */
export function MessagesApp({ messages }: { messages: SmsMessageRow[] }) {
    const t = useTranslations('messages')
    const locale = useLocale()

    return (
        <Stack gap="sm" data-testid="simulator-messages">
            {messages.length === 0 ? (
                <Text size="xs" c="gray.5" data-testid="messages-empty">
                    {t('empty')}
                </Text>
            ) : (
                <Stack gap={0} data-testid="messages-list">
                    {messages.map((message) => (
                        <Box
                            key={message.id}
                            data-testid={`message-item-${message.id}`}
                            py="xs"
                            style={{ borderBottom: '1px solid rgba(255,255,255,0.12)' }}
                        >
                            <Group justify="space-between" wrap="nowrap" gap="xs">
                                <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                                    <Badge size="xs" variant="light" color="grape">
                                        {message.kind}
                                    </Badge>
                                    <Text size="sm" fw={600} c="gray.0" truncate>
                                        {t('toLine', { to: message.to })}
                                    </Text>
                                </Group>
                                <Text size="xs" c="gray.6" style={{ whiteSpace: 'nowrap' }}>
                                    {formatWhen(message.at, locale)}
                                </Text>
                            </Group>
                            <Text size="xs" c="gray.4" mt={2} data-testid="message-body">
                                {message.body}
                            </Text>
                        </Box>
                    ))}
                </Stack>
            )}
        </Stack>
    )
}
