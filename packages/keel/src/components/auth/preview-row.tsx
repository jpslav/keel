'use client'

import { Avatar, Group, Stack, Text } from '@mantine/core'
import type { ReactNode } from 'react'

// Avatars are a dark filled neutral (white initials on near-black): the hash-colored
// `color="initials"` variants — and even Mantine's default gray placeholder — land at ~3.7–4.4:1 for
// many hue+initials combinations and can't clear WCAG AA reliably (autoContrast's threshold doesn't
// align with 4.5:1 either). White-on-dark is ~15:1 for any initials. See docs/build-notes.md.

/**
 * The one identity row behind both the OrgSwitcher and the UserMenu — an initials avatar plus a
 * stacked title / subtitle, truncation-safe. Clerk composes its OrganizationPreview and UserPreview
 * from a single such element; we do the same in Mantine (ADR-0003, one owned auth UI).
 */
export function PreviewRow({
    name,
    title,
    subtitle,
    badge,
    rounded = false,
    size = 'md',
}: {
    /** Seeds the initials avatar (org name or person name). */
    name: string
    title: string
    subtitle?: ReactNode
    badge?: ReactNode
    /** Round avatar for people, squared for orgs (mirrors Clerk's org-vs-user distinction). */
    rounded?: boolean
    size?: 'sm' | 'md'
}) {
    const dim = size === 'sm' ? 30 : 38
    return (
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <Avatar
                name={name}
                radius={rounded ? 'xl' : 'sm'}
                size={dim}
                styles={{
                    placeholder: { color: '#fff', background: 'var(--mantine-color-dark-6)' },
                }}
            />
            <Stack gap={2} style={{ minWidth: 0 }}>
                <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                    {/* Explicit dark color: inside Mantine's Menu.Label (user menu header) an
                        uncolored Text would inherit the label's dimmed gray-6 (~3.3:1, fails AA). */}
                    <Text size="sm" fw={600} truncate c="gray.9">
                        {title}
                    </Text>
                    {badge}
                </Group>
                {subtitle != null ? (
                    <Text size="xs" c="gray.7" truncate component="div">
                        {subtitle}
                    </Text>
                ) : null}
            </Stack>
        </Group>
    )
}
