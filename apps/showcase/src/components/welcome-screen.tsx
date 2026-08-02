'use client'

import { Anchor, Badge, Button, Card, Container, Group, Stack, Text, TextInput, Title } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { normalizeDisplayName } from 'keel/core/greeting'

/** Router-agnostic screen: no Next imports, usable from app routes, Ladle, and the static demo shell. */
export function WelcomeScreen({ dashboardHref }: { dashboardHref?: string }) {
    const t = useTranslations('welcome')
    const [greeted, setGreeted] = useState<string | null>(null)
    const form = useForm({
        initialValues: { name: '' },
        validate: {
            name: (value) => (value.trim() ? null : t('nameRequired')),
        },
    })

    return (
        <Container component="main" size="sm" py="xl">
            <Stack gap="lg">
                <Group justify="space-between" align="center">
                    <Title order={1}>{t('title')}</Title>
                    {/* variant="default" keeps WCAG AA contrast regardless of tenant primary color */}
                    <Badge variant="default">{t('badge')}</Badge>
                </Group>
                <Text c="gray.7">{t('subtitle')}</Text>
                <Card withBorder padding="lg" radius="md">
                    <form onSubmit={form.onSubmit(({ name }) => setGreeted(normalizeDisplayName(name)))}>
                        <Stack>
                            <TextInput
                                label={t('nameLabel')}
                                placeholder={t('namePlaceholder')}
                                {...form.getInputProps('name')}
                            />
                            <Button type="submit">{t('greetButton')}</Button>
                            {greeted ? <Text data-testid="greeting">{t('greeting', { name: greeted })}</Text> : null}
                        </Stack>
                    </form>
                </Card>
                {dashboardHref ? (
                    <Anchor href={dashboardHref} data-testid="dashboard-link">
                        {t('dashboardLink')}
                    </Anchor>
                ) : null}
            </Stack>
        </Container>
    )
}
