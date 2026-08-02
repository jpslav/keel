'use client'

import { Card, Switch, Table, Text, Title } from '@mantine/core'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import {
    NOTIFICATION_CHANNELS,
    NOTIFICATION_KINDS,
    type NotificationChannel,
    type NotificationKind,
    type NotificationPrefRow,
    isChannelEnabled,
    notificationNamespace,
} from '../../core/notifications'

/**
 * i18n label key for a notification kind, in the `notifications` namespace.
 *
 * DERIVED, not enumerated. This was a `Record<NotificationKind, string>` literal — which cannot be
 * written by the framework at all, because `NotificationKind` includes whatever kinds the APP
 * registers through the seam, so the literal cannot enumerate the app kinds it does not know
 * hard-coded into a framework file. The convention it already followed is a total function:
 * `org.invited` → `kindOrgInvited`, `<app>.<event>` → `kindAppEvent`. Any registered
 * kind now resolves without the framework knowing its name.
 */
function kindLabelKey(kind: NotificationKind): string {
    return kind.split(/[._-]/).reduce((key, part) => key + part.charAt(0).toUpperCase() + part.slice(1), 'kind')
}

/** Fully-qualified label path: the derived key, resolved in whichever CATALOG owns that kind's copy. */
function kindLabelPath(kind: NotificationKind): string {
    return `${notificationNamespace(kind)}.${kindLabelKey(kind)}`
}

const CHANNEL_LABEL: Record<NotificationChannel, string> = {
    in_app: 'channelInApp',
    email: 'channelEmail',
    sms: 'channelSms',
}

/**
 * The notification-preferences grid — a kind × channel toggle matrix on the profile screen.
 * Router-agnostic: the glue owns the GET/POST; this renders the current prefs and calls `onToggle`.
 * OPT-OUT default: a switch is ON unless the user's stored prefs disable that (kind, channel) — the
 * SHARED core resolver (isChannelEnabled) decides, so the UI and the fan-out agree by construction.
 * Reused verbatim by the static-demo twin.
 */
export function NotificationPrefsSection({
    prefs,
    onToggle,
}: {
    prefs: NotificationPrefRow[]
    onToggle: (kind: NotificationKind, channel: NotificationChannel, enabled: boolean) => Promise<void>
}) {
    const t = useTranslations('notifications')
    // Root translator for kind labels: an app-registered kind's label lives in the app's catalog.
    const tRoot = useTranslations()
    const [busy, setBusy] = useState<string | null>(null)

    return (
        <Card withBorder padding="lg" radius="md" data-testid="notification-prefs">
            <Title order={2} size="h3" mb="xs">
                {t('prefsSection')}
            </Title>
            <Text c="gray.7" size="sm" mb="md">
                {t('prefsHint')}
            </Text>
            <Table>
                <Table.Thead>
                    <Table.Tr>
                        <Table.Th>{t('prefsKindColumn')}</Table.Th>
                        {NOTIFICATION_CHANNELS.map((channel) => (
                            <Table.Th key={channel} ta="center">
                                {t(CHANNEL_LABEL[channel])}
                            </Table.Th>
                        ))}
                    </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                    {NOTIFICATION_KINDS.map((kind) => (
                        <Table.Tr key={kind}>
                            <Table.Td>{tRoot(kindLabelPath(kind))}</Table.Td>
                            {NOTIFICATION_CHANNELS.map((channel) => {
                                const key = `${kind}:${channel}`
                                return (
                                    <Table.Td key={channel} ta="center">
                                        <Switch
                                            checked={isChannelEnabled(prefs, kind, channel)}
                                            disabled={busy !== null}
                                            aria-label={t('prefToggleAria', {
                                                kind: tRoot(kindLabelPath(kind)),
                                                channel: t(CHANNEL_LABEL[channel]),
                                            })}
                                            data-testid={`pref-${kind}-${channel}`}
                                            onChange={(event) => {
                                                setBusy(key)
                                                void onToggle(kind, channel, event.currentTarget.checked).finally(() =>
                                                    setBusy(null),
                                                )
                                            }}
                                            style={{ display: 'inline-block' }}
                                        />
                                    </Table.Td>
                                )
                            })}
                        </Table.Tr>
                    ))}
                </Table.Tbody>
            </Table>
        </Card>
    )
}
