'use client'

import { Card, Container, Stack, Text, Title } from '@mantine/core'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

/**
 * The single sign-in surface (ADR-0003). In simulated mode `body` is the PeoplePicker; in real mode
 * it is the Clerk-headless credential form injected by the route glue. Same card either way.
 */
export function SignInScreen({ body }: { body: ReactNode }) {
    const t = useTranslations('auth')
    return (
        <Container component="main" size="xs" py="xl">
            <Stack gap="md">
                <Title order={1}>{t('signInTitle')}</Title>
                <Text c="gray.7">{t('signInSubtitle')}</Text>
                <Card withBorder padding="lg" radius="md">
                    {body}
                </Card>
            </Stack>
        </Container>
    )
}
