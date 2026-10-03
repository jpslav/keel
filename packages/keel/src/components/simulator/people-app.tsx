'use client'

import { Group, Stack, Text, UnstyledButton } from '@mantine/core'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

export interface Person {
    key: string
    /** null for an invited-but-unregistered person — there's no account yet to hold a name. */
    name: string | null
    email: string
    role: string
    /** Every org (product copy: "team") the person belongs to, with their role IN that org. When
     *  present it replaces the single `role` chip — a multi-org person's role differs per org, so one
     *  role alone misstates every membership but the first. */
    orgs?: { orgSlug: string; role: string }[]
    tenantSlug: string
    status: 'active' | 'invited'
    hasAccount: boolean
    unreadMail: number
}

/** The panel-wide pill look for tiny metadata chips (org·role/tenant here, the header's invited
 *  badge) — exported so the two stay in lockstep. */
export const chipStyle = {
    border: '1px solid rgba(255,255,255,0.25)',
    borderRadius: 999,
    padding: '1px 8px',
}

/** Router-agnostic People tab (ADR-0006 twin lives in keel/demo-static): one row per known person —
 *  seeded/dynamic people AND invited-but-unregistered people alike — current viewpoint
 *  highlighted, click to switch. Invited rows have no name yet, so they show their email as the
 *  label plus an "invited" badge; they're still selectable (as a viewpoint, not a sign-in). */
export function PeopleApp({
    people,
    viewpoint,
    onSelect,
}: {
    people: Person[]
    viewpoint: string | null
    onSelect: (key: string) => void
}) {
    const t = useTranslations('simulator')
    // Rows carry a persistent border + faint fill so they read as buttons at rest; hover lifts the
    // non-active fill (local state — no global CSS), the active row stays brightest.
    const [hoveredKey, setHoveredKey] = useState<string | null>(null)
    return (
        <Stack gap={6} data-testid="simulator-people">
            {people.map((person) => {
                const idPart = person.key.replace(/^(person|invited):/, '')
                const active = person.key === viewpoint
                const hovered = person.key === hoveredKey
                const background = active
                    ? 'rgba(255,255,255,0.14)'
                    : hovered
                      ? 'rgba(255,255,255,0.10)'
                      : 'rgba(255,255,255,0.04)'
                return (
                    <UnstyledButton
                        key={person.key}
                        onClick={() => onSelect(person.key)}
                        onMouseEnter={() => setHoveredKey(person.key)}
                        onMouseLeave={() => setHoveredKey((current) => (current === person.key ? null : current))}
                        data-testid={`people-${idPart}`}
                        aria-current={active ? 'true' : undefined}
                        style={{
                            borderRadius: 8,
                            padding: '8px 10px',
                            background,
                            border: active ? '1px solid rgba(255,255,255,0.45)' : '1px solid rgba(255,255,255,0.18)',
                        }}
                    >
                        <Group justify="space-between" wrap="nowrap" gap="xs">
                            <Stack gap={0}>
                                <Text size="sm" fw={600} c="gray.0">
                                    {person.name ?? person.email}
                                </Text>
                                {person.name ? (
                                    <Text size="xs" c="gray.5">
                                        {person.email}
                                    </Text>
                                ) : null}
                            </Stack>
                            <Group gap={4} wrap="nowrap">
                                {person.orgs && person.orgs.length > 0 ? (
                                    person.orgs.map((org) => (
                                        <Text
                                            key={org.orgSlug}
                                            size="xs"
                                            c="gray.3"
                                            style={chipStyle}
                                            data-testid={`people-${idPart}-org-${org.orgSlug}`}
                                        >
                                            {t('peopleOrgRole', { org: org.orgSlug, role: org.role })}
                                        </Text>
                                    ))
                                ) : (
                                    <Text size="xs" c="gray.3" style={chipStyle}>
                                        {person.role}
                                    </Text>
                                )}
                                <Text size="xs" c="gray.3" style={chipStyle}>
                                    {person.tenantSlug}
                                </Text>
                                {person.status === 'invited' ? (
                                    <Text size="xs" c="gray.3" style={chipStyle} data-testid="people-invited-badge">
                                        {t('peopleInvitedBadge')}
                                    </Text>
                                ) : null}
                                {person.unreadMail > 0 ? (
                                    <Text
                                        size="xs"
                                        fw={700}
                                        style={{
                                            background: '#c92a2a',
                                            color: '#fff',
                                            borderRadius: 999,
                                            padding: '1px 7px',
                                        }}
                                    >
                                        {person.unreadMail}
                                    </Text>
                                ) : null}
                            </Group>
                        </Group>
                    </UnstyledButton>
                )
            })}
        </Stack>
    )
}
