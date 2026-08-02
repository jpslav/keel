'use client'

import { Box, Menu, ScrollArea, Stack, Text, UnstyledButton } from '@mantine/core'
import { useLocale, useTranslations } from 'next-intl'
import {
    FRAMEWORK_NOTIFICATION_NAMESPACE,
    type NotificationKind,
    type NotificationPayload,
    notificationCopy,
} from '../../core/notifications'
import { BellIcon } from '../auth/auth-icons'
import { formatWhen } from '../simulator/format-when'

export interface NotificationItem {
    id: string
    kind: NotificationKind
    payload: NotificationPayload
    readAt: string | null
    createdAt: string
}

/**
 * The header notification bell — router-agnostic (no fetch, no navigation): the glue owns the
 * poll + the mark-read POST and passes data + callbacks. An unread pill sits on the bell (the
 * simulator-panel count-pill pattern); opening the popover fires `onOpen` (the glue marks all read, so
 * the badge clears on open — the recorded mark-all-on-open decision). Copy is rendered from each item's
 * kind + payload via the SHARED core `notificationCopy` mapper, so the list, the emails, and the SMS can
 * never drift. Reused verbatim by the static-demo twin.
 */
export function NotificationBell({
    items,
    unread,
    onOpen,
}: {
    items: NotificationItem[]
    unread: number
    onOpen: () => void
}) {
    const t = useTranslations('notifications')
    // Root translator too: an APP-registered kind's copy lives in the app catalog, and the namespace to
    // resolve it in comes from notificationCopy (core/notifications.ts).
    const tRoot = useTranslations()
    const locale = useLocale()

    return (
        <Menu position="bottom-end" width={360} onOpen={onOpen}>
            <Menu.Target>
                <UnstyledButton
                    aria-label={t('bellLabel', { count: unread })}
                    data-testid="notification-bell"
                    style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
                >
                    <BellIcon />
                    {unread > 0 ? (
                        <Text
                            component="span"
                            size="xs"
                            fw={700}
                            data-testid="notification-unread-count"
                            style={{
                                position: 'absolute',
                                top: -6,
                                right: -8,
                                background: '#c92a2a',
                                color: '#fff',
                                borderRadius: 999,
                                padding: '0 6px',
                                lineHeight: '16px',
                            }}
                        >
                            {unread}
                        </Text>
                    ) : null}
                </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
                <Menu.Label>{t('title')}</Menu.Label>
                {items.length === 0 ? (
                    <Text c="gray.6" size="sm" px="sm" py="xs" data-testid="notification-empty">
                        {t('empty')}
                    </Text>
                ) : (
                    <ScrollArea.Autosize mah={360} type="auto">
                        <Stack gap={0}>
                            {items.map((item) => {
                                const copy = notificationCopy(item.kind, item.payload)
                                const ns = copy.namespace ?? FRAMEWORK_NOTIFICATION_NAMESPACE
                                return (
                                    <Box
                                        key={item.id}
                                        data-testid="notification-item"
                                        px="sm"
                                        py="xs"
                                        style={{
                                            borderTop: '1px solid var(--mantine-color-gray-2)',
                                            background:
                                                item.readAt === null ? 'var(--mantine-color-blue-0)' : undefined,
                                        }}
                                    >
                                        <Text size="sm" fw={item.readAt === null ? 700 : 500}>
                                            {tRoot(`${ns}.${copy.titleKey}`, copy.values)}
                                        </Text>
                                        <Text size="xs" c="gray.7">
                                            {tRoot(`${ns}.${copy.bodyKey}`, copy.values)}
                                        </Text>
                                        <Text size="xs" c="gray.5">
                                            {formatWhen(item.createdAt, locale)}
                                        </Text>
                                    </Box>
                                )
                            })}
                        </Stack>
                    </ScrollArea.Autosize>
                )}
            </Menu.Dropdown>
        </Menu>
    )
}
