'use client'

import { Anchor, Container, Stack, Text, Title } from '@mantine/core'
import { useTranslations } from 'next-intl'

/** Router-agnostic landing screen: no Next imports, so the app route and the static twin share it. */
export function WelcomeScreen({ dashboardHref }: { dashboardHref: string }) {
    const t = useTranslations('welcome')
    return (
        <Container component="main" size="sm" py="xl">
            <Stack gap="lg">
                <Title order={1}>{t('title')}</Title>
                <Text c="gray.7">{t('subtitle')}</Text>
                <Anchor href={dashboardHref} data-testid="dashboard-link">
                    {t('dashboardLink')}
                </Anchor>
            </Stack>
        </Container>
    )
}
