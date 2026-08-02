'use client'

import { Button, Card, Container, Select, Stack, Text, TextInput, Title } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useTranslations } from 'next-intl'
import { type ReactNode, useState } from 'react'

export interface ProfileValues {
    name: string
    locale: string
}

/**
 * Lean take on Clerk's UserProfile (ADR-0003): a sectioned account page. The Profile section is live;
 * the Security section is a named seam so MFA / password / connected accounts have a home when those
 * slices land (each becomes a port method + adapter pair, per the auth-UI playbook). `extraSection` is
 * a generic slot for further account cards (the notification-preferences grid lands here)
 * without coupling this screen to any one feature.
 */
export function ProfileScreen({
    initial,
    email,
    locales,
    onSave,
    extraSection,
}: {
    initial: ProfileValues
    email: string
    locales: string[]
    onSave: (values: ProfileValues) => Promise<void>
    extraSection?: ReactNode
}) {
    const t = useTranslations('profile')
    const [saved, setSaved] = useState(false)
    const [busy, setBusy] = useState(false)
    const form = useForm({ initialValues: initial })

    return (
        <Container component="main" size="sm" py="xl">
            <Stack gap="lg">
                <Title order={1}>{t('title')}</Title>

                <Card withBorder padding="lg" radius="md">
                    <Title order={2} size="h3" mb="md">
                        {t('profileSection')}
                    </Title>
                    <form
                        onSubmit={form.onSubmit((values) => {
                            setBusy(true)
                            setSaved(false)
                            onSave(values)
                                .then(() => setSaved(true))
                                .finally(() => setBusy(false))
                        })}
                    >
                        <Stack>
                            <TextInput label={t('emailLabel')} value={email} disabled />
                            <TextInput
                                label={t('nameLabel')}
                                data-testid="profile-name"
                                {...form.getInputProps('name')}
                            />
                            <Select
                                label={t('localeLabel')}
                                data={locales}
                                allowDeselect={false}
                                data-testid="profile-locale"
                                {...form.getInputProps('locale')}
                            />
                            <Button
                                type="submit"
                                loading={busy}
                                data-testid="profile-save"
                                style={{ alignSelf: 'start' }}
                            >
                                {t('saveButton')}
                            </Button>
                            {saved ? (
                                <Text c="green.8" size="sm" data-testid="profile-saved">
                                    {t('saved')}
                                </Text>
                            ) : null}
                        </Stack>
                    </form>
                </Card>

                {extraSection}

                <Card withBorder padding="lg" radius="md">
                    <Title order={2} size="h3" mb="xs">
                        {t('securitySection')}
                    </Title>
                    <Text c="gray.7" size="sm" data-testid="security-soon">
                        {t('securitySoon')}
                    </Text>
                </Card>
            </Stack>
        </Container>
    )
}
