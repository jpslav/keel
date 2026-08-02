'use client'

import { Group, Menu, UnstyledButton } from '@mantine/core'
import { useTranslations } from 'next-intl'
import { CheckIcon, ChevronDownIcon } from './auth-icons'
import { PreviewRow } from './preview-row'

export interface SwitcherOrg {
    slug: string
    name: string
    /** The user's role in this org — shown as the popover sub-line (optional; omitted in the twin). */
    role?: string
}

/**
 * Lean take on Clerk's OrganizationSwitcher (ADR-0003): the trigger is the active org as a preview
 * row + chevron; the popover lists every membership as a preview row (role sub-line, active check).
 * Hidden when the user belongs to a single org — there's nothing to switch.
 */
export function OrgSwitcher({
    orgs,
    activeSlug,
    onSwitch,
}: {
    orgs: SwitcherOrg[]
    activeSlug: string
    onSwitch: (slug: string) => void
}) {
    const t = useTranslations('org')
    if (orgs.length <= 1) return null
    const active = orgs.find((o) => o.slug === activeSlug) ?? orgs[0]

    return (
        <Menu position="bottom-end" width={264} withinPortal>
            <Menu.Target>
                <UnstyledButton
                    data-testid="org-switcher"
                    aria-label={t('switchLabel')}
                    style={{
                        maxWidth: 220,
                        padding: '4px 8px',
                        borderRadius: 'var(--mantine-radius-default)',
                        border: '1px solid var(--mantine-color-gray-3)',
                    }}
                >
                    <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                        <PreviewRow name={active.name} title={active.name} size="sm" />
                        <ChevronDownIcon />
                    </Group>
                </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
                {/* Mantine's default Menu.Label color is `dimmed` (gray-6, ~2.7:1) — bump to gray.7 for AA. */}
                <Menu.Label c="gray.7">{t('switchLabel')}</Menu.Label>
                {orgs.map((org) => (
                    <Menu.Item
                        key={org.slug}
                        data-testid={`org-switcher-item-${org.slug}`}
                        onClick={() => {
                            if (org.slug !== activeSlug) onSwitch(org.slug)
                        }}
                        rightSection={org.slug === active.slug ? <CheckIcon /> : undefined}
                    >
                        <PreviewRow name={org.name} title={org.name} subtitle={org.role} size="sm" />
                    </Menu.Item>
                ))}
            </Menu.Dropdown>
        </Menu>
    )
}
