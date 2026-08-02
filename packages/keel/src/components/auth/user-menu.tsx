'use client'

import { Avatar, Menu, UnstyledButton } from '@mantine/core'
import { useTranslations } from 'next-intl'
import { SignOutIcon, UserIcon } from './auth-icons'
import { PreviewRow } from './preview-row'

export interface MenuUser {
    name: string
    email: string
}

/**
 * Lean take on Clerk's UserButton (ADR-0003): an avatar trigger opening a popover whose header is
 * the user preview row (name + email), then the account actions with leading icons.
 */
export function UserMenu({
    user,
    onProfile,
    onSignOut,
}: {
    user: MenuUser
    /** Omit in an app that mounts no profile route — the entry is then not offered at all, which is
     *  the UI form of ADR-0012's "unused capability = empty registration". */
    onProfile?: () => void
    onSignOut: () => void
}) {
    const t = useTranslations('auth')

    return (
        <Menu position="bottom-end" width={260}>
            <Menu.Target>
                <UnstyledButton aria-label={t('userMenuLabel')} data-testid="user-menu">
                    <Avatar
                        name={user.name}
                        radius="xl"
                        styles={{ placeholder: { color: '#fff', background: 'var(--mantine-color-dark-6)' } }}
                    />
                </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
                <Menu.Label>
                    <PreviewRow name={user.name} title={user.name} subtitle={user.email} rounded />
                </Menu.Label>
                <Menu.Divider />
                {onProfile ? (
                    <Menu.Item leftSection={<UserIcon />} onClick={onProfile} data-testid="menu-profile">
                        {t('profileLink')}
                    </Menu.Item>
                ) : null}
                <Menu.Item leftSection={<SignOutIcon />} onClick={onSignOut} data-testid="menu-signout">
                    {t('signOut')}
                </Menu.Item>
            </Menu.Dropdown>
        </Menu>
    )
}
