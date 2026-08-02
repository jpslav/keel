'use client'

import { Container, Stack, Text, Title } from '@mantine/core'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

export interface DashboardUser {
    name: string
    role: string
}

/** Signed-in landing screen. Router-agnostic (ADR-0006); the cards are slotted in as children. */
export function DashboardScreen({ user, children }: { user: DashboardUser; children: ReactNode }) {
    const t = useTranslations('dashboard')
    return (
        <Container component="main" size="sm" py="xl">
            <Stack gap="lg">
                <Title order={1}>{t('title')}</Title>
                <Text c="gray.7" data-testid="signed-in-as">
                    {t('signedInAs', { name: user.name, role: user.role })}
                </Text>
                {children}
            </Stack>
        </Container>
    )
}
