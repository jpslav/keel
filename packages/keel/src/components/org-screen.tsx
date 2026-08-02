'use client'

import { Badge, Button, Card, Container, Group, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import { useState } from 'react'

export interface OrgMember {
    id: string
    name: string | null
    email: string
    role: string
    status: 'active' | 'invited'
}

/**
 * Role → Badge hue. Restricted to dark-based hues whose `light` variant clears WCAG AA at this small
 * bold size — yellow/orange/lime/green/teal land at ~2.7–4.4:1 (axe: color-contrast). Unknown roles
 * fall back to gray.
 */
const ROLE_COLORS: Record<string, string> = {
    admin: 'grape',
    staff: 'indigo',
    member: 'blue',
    guest: 'gray',
    restricted: 'violet',
}

function RoleBadge({ role }: { role: string }) {
    return (
        <Badge color={ROLE_COLORS[role] ?? 'gray'} variant="light" radius="sm">
            {role}
        </Badge>
    )
}

/**
 * Lean take on Clerk's OrganizationProfile (ADR-0003): an active-members section and a separate
 * pending-invitations section, plus the invite flow (exercises auth + email + db ports together).
 */
export function OrgScreen({
    orgName,
    members,
    roles,
    canManage,
    onInvite,
    error,
    children,
}: {
    orgName: string
    members: OrgMember[]
    roles: string[]
    canManage: boolean
    onInvite: (invite: { email: string; role: string }) => Promise<void>
    /** Already-localized failure message from the caller (e.g. duplicate invite) — see org-glue. */
    error?: string | null
    /** Admin-only extra cards rendered inside the same main landmark (e.g. webhook endpoints). */
    children?: ReactNode
}) {
    const t = useTranslations('org')
    const [busy, setBusy] = useState(false)
    const [sentTo, setSentTo] = useState<string | null>(null)
    const form = useForm({
        initialValues: { email: '', role: roles.includes('member') ? 'member' : roles[0] },
        validate: { email: (value) => (/.+@.+\..+/.test(value) ? null : t('emailInvalid')) },
    })

    const active = members.filter((m) => m.status === 'active')
    const pending = members.filter((m) => m.status === 'invited')

    return (
        <Container component="main" size="md" py="xl">
            <Stack gap="lg">
                <Title order={1}>{t('title', { org: orgName })}</Title>

                <Card withBorder padding="lg" radius="md">
                    <Group justify="space-between" mb="sm">
                        <Title order={2} size="h3">
                            {t('membersHeading')}
                        </Title>
                        <Badge variant="default" radius="sm">
                            {active.length}
                        </Badge>
                    </Group>
                    <Table data-testid="member-table" verticalSpacing="sm">
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>{t('colName')}</Table.Th>
                                <Table.Th>{t('colEmail')}</Table.Th>
                                <Table.Th>{t('colRole')}</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {active.map((member) => (
                                <Table.Tr key={member.id} data-testid={`member-${member.email}`}>
                                    <Table.Td>{member.name ?? '—'}</Table.Td>
                                    <Table.Td>{member.email}</Table.Td>
                                    <Table.Td>
                                        <RoleBadge role={member.role} />
                                    </Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                </Card>

                {pending.length > 0 && (
                    <Card withBorder padding="lg" radius="md">
                        <Title order={2} size="h3" mb="sm">
                            {t('pendingHeading')}
                        </Title>
                        <Table data-testid="pending-table" verticalSpacing="sm">
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>{t('colEmail')}</Table.Th>
                                    <Table.Th>{t('colRole')}</Table.Th>
                                    <Table.Th>{t('colStatus')}</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {pending.map((member) => (
                                    <Table.Tr key={member.id} data-testid={`invite-${member.email}`}>
                                        <Table.Td>{member.email}</Table.Td>
                                        <Table.Td>
                                            <RoleBadge role={member.role} />
                                        </Table.Td>
                                        <Table.Td>
                                            <Badge variant="default" radius="sm">
                                                {t('statusInvited')}
                                            </Badge>
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </Card>
                )}

                {canManage && (
                    <Card withBorder padding="lg" radius="md">
                        <Title order={2} size="h3" mb="sm">
                            {t('inviteHeading')}
                        </Title>
                        <form
                            onSubmit={form.onSubmit((values) => {
                                setBusy(true)
                                setSentTo(null)
                                onInvite({ email: values.email, role: values.role ?? 'member' })
                                    .then(() => {
                                        setSentTo(values.email)
                                        form.reset()
                                    })
                                    .catch(() => {
                                        // the caller surfaced the failure through the `error` prop
                                    })
                                    .finally(() => setBusy(false))
                            })}
                        >
                            <Group align="end" gap="sm">
                                <TextInput
                                    label={t('emailLabel')}
                                    flex={1}
                                    data-testid="invite-email"
                                    {...form.getInputProps('email')}
                                />
                                <Select
                                    label={t('roleLabel')}
                                    data={roles}
                                    w={160}
                                    allowDeselect={false}
                                    data-testid="invite-role"
                                    {...form.getInputProps('role')}
                                />
                                <Button type="submit" loading={busy} data-testid="invite-submit">
                                    {t('inviteButton')}
                                </Button>
                            </Group>
                            {sentTo ? (
                                <Text mt="sm" c="green.8" size="sm" data-testid="invite-sent">
                                    {t('inviteSent', { email: sentTo })}
                                </Text>
                            ) : null}
                            {error ? (
                                <Text mt="sm" c="red.8" size="sm" data-testid="invite-error">
                                    {error}
                                </Text>
                            ) : null}
                        </form>
                    </Card>
                )}

                {children}
            </Stack>
        </Container>
    )
}
