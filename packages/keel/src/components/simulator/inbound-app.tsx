'use client'

import { Box, Button, Group, NativeSelect, Stack, Text, TextInput, Textarea } from '@mantine/core'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { chipStyle } from './people-app'
import { formatWhen } from './format-when'

/** One inbound message as the Simulator world view sees it (packages/keel/src/db/inbound-email.ts WorldInboundEmail). */
export interface InboundEmailRow {
    id: string
    toEmail: string
    fromEmail: string
    subject: string
    status: string
    handler: string | null
    error: string | null
    createdAt: string
    tenantSlug: string
    orgSlug: string | null
}

export interface InboundComposeInput {
    from: string
    orgSlug: string
    handler: string
    subject: string
    body: string
}

export interface InboundAppProps {
    inbound: InboundEmailRow[]
    orgs: { slug: string; name: string; tenantSlug: string }[]
    people: { email: string; name: string }[]
    handlers: string[]
    domain: string
    onCompose: (input: InboundComposeInput) => void
}

/** Mantine text colour cue per intake status (the jobs-app/hooks-app chip pattern — a `.4` shade on
 *  the dark panel meets AA, unlike a white-on-fill Badge; presentational only). */
function statusColor(status: string): string {
    switch (status) {
        case 'handled':
            return 'teal.4'
        case 'unmatched':
            return 'yellow.4'
        case 'failed':
            return 'red.4'
        default:
            return 'gray.4'
    }
}

/**
 * The Mail tab's "compose inbound" affordance + inbound list: the world emails the app. Data
 * and callbacks only — the glue (simulator-glue.tsx) owns fetching and the POST, and the static-demo
 * twin drives the same props over its in-memory intake. Native <select>s (not Mantine comboboxes) keep
 * the compose form trivially Playwright-selectable. The handler is a free-text field so an unknown slug
 * can be sent on purpose to demonstrate the 'unmatched' path.
 */
export function InboundApp({ inbound, orgs, people, handlers, domain, onCompose }: InboundAppProps) {
    const t = useTranslations('simulator')
    const locale = useLocale()
    const [from, setFrom] = useState('')
    const [orgSlug, setOrgSlug] = useState('')
    const [handler, setHandler] = useState('note')
    const [subject, setSubject] = useState('')
    const [body, setBody] = useState('')

    const effectiveFrom = from || people[0]?.email || ''
    const effectiveOrg = orgSlug || orgs[0]?.slug || ''
    const address = effectiveOrg && handler ? `${effectiveOrg}+${handler}@${domain}` : ''
    const canSend = Boolean(effectiveFrom && effectiveOrg && handler.trim())

    function send() {
        if (!canSend) return
        onCompose({ from: effectiveFrom, orgSlug: effectiveOrg, handler: handler.trim(), subject, body })
        setSubject('')
        setBody('')
    }

    return (
        <Stack gap="md" data-testid="simulator-inbound">
            <Box
                data-testid="inbound-compose"
                style={{ border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, padding: 10 }}
            >
                <Stack gap="xs">
                    <Text size="sm" fw={700} c="gray.1">
                        {t('inboundComposeHeading')}
                    </Text>
                    <Text size="xs" c="gray.5">
                        {t('inboundComposeHint')}
                    </Text>
                    <NativeSelect
                        size="xs"
                        data-testid="inbound-compose-from"
                        label={t('inboundFromLabel')}
                        value={effectiveFrom}
                        onChange={(event) => setFrom(event.currentTarget.value)}
                        data={people.map((person) => ({
                            value: person.email,
                            label: `${person.name} (${person.email})`,
                        }))}
                    />
                    <Group grow gap="xs">
                        <NativeSelect
                            size="xs"
                            data-testid="inbound-compose-org"
                            label={t('inboundOrgLabel')}
                            value={effectiveOrg}
                            onChange={(event) => setOrgSlug(event.currentTarget.value)}
                            data={orgs.map((org) => ({
                                value: org.slug,
                                label: `${org.name} (${org.tenantSlug})`,
                            }))}
                        />
                        <TextInput
                            size="xs"
                            data-testid="inbound-compose-handler"
                            label={t('inboundHandlerLabel')}
                            value={handler}
                            onChange={(event) => setHandler(event.currentTarget.value)}
                        />
                    </Group>
                    <Text size="xs" c="gray.6" data-testid="inbound-compose-address">
                        {t('inboundAddressPreview', { address })}
                    </Text>
                    <Text size="xs" c="gray.6">
                        {t('inboundHandlersHint', { handlers: handlers.join(', ') })}
                    </Text>
                    <TextInput
                        size="xs"
                        data-testid="inbound-compose-subject"
                        label={t('inboundSubjectLabel')}
                        value={subject}
                        onChange={(event) => setSubject(event.currentTarget.value)}
                    />
                    <Textarea
                        size="xs"
                        data-testid="inbound-compose-body"
                        label={t('inboundBodyLabel')}
                        autosize
                        minRows={2}
                        value={body}
                        onChange={(event) => setBody(event.currentTarget.value)}
                    />
                    <Group justify="flex-end">
                        <Button size="compact-sm" data-testid="inbound-compose-send" disabled={!canSend} onClick={send}>
                            {t('inboundSendButton')}
                        </Button>
                    </Group>
                </Stack>
            </Box>

            <Stack gap={4}>
                <Text size="sm" fw={700} c="gray.1">
                    {t('inboundListHeading')}
                </Text>
                {inbound.length === 0 ? (
                    <Text size="xs" c="gray.5" data-testid="inbound-empty">
                        {t('inboundEmpty')}
                    </Text>
                ) : (
                    <Stack gap={0} data-testid="inbound-list">
                        {inbound.map((item) => (
                            <Box
                                key={item.id}
                                data-testid={`inbound-item-${item.id}`}
                                style={{ borderBottom: '1px solid rgba(255,255,255,0.12)', padding: '6px 4px' }}
                            >
                                <Group justify="space-between" wrap="nowrap" gap="xs">
                                    <Text size="sm" c="gray.0" truncate style={{ minWidth: 0 }}>
                                        {item.subject || t('inboundNoSubject')}
                                    </Text>
                                    <Group gap={6} wrap="nowrap">
                                        <Text
                                            size="xs"
                                            fw={700}
                                            c={statusColor(item.status)}
                                            style={chipStyle}
                                            data-testid={`inbound-status-${item.id}`}
                                        >
                                            {t(`inboundStatus_${item.status}` as 'inboundStatus_handled')}
                                        </Text>
                                        <Text size="xs" c="gray.6" style={{ whiteSpace: 'nowrap' }}>
                                            {formatWhen(item.createdAt, locale)}
                                        </Text>
                                    </Group>
                                </Group>
                                <Text size="xs" c="gray.5" truncate>
                                    {t('inboundMetaLine', {
                                        to: item.toEmail,
                                        from: item.fromEmail,
                                    })}
                                </Text>
                                {item.error ? (
                                    <Text size="xs" c="yellow.6" truncate>
                                        {t('inboundErrorLine', { error: item.error })}
                                    </Text>
                                ) : null}
                            </Box>
                        ))}
                    </Stack>
                )}
            </Stack>
        </Stack>
    )
}
