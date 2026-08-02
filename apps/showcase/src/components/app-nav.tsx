'use client'

import { Button, Group } from '@mantine/core'
import { useTranslations } from 'next-intl'

/** Router-agnostic primary nav shown to every signed-in user (ADR-0006). */
export function AppNav({ onNavigate }: { onNavigate: (target: 'dashboard' | 'org') => void }) {
    const t = useTranslations('nav')
    return (
        <Group gap="xs">
            <Button variant="subtle" size="xs" data-testid="nav-dashboard" onClick={() => onNavigate('dashboard')}>
                {t('dashboard')}
            </Button>
            <Button variant="subtle" size="xs" data-testid="nav-org" onClick={() => onNavigate('org')}>
                {t('org')}
            </Button>
        </Group>
    )
}
