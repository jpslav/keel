'use client'

import { Button, Card, Container, Stack, Text, TextInput, Title } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import { useState } from 'react'

/**
 * Shared shell for every accept-invite state — the fake name-form flow below AND the real
 * Clerk-ticket flow (whose form slots in from packages/keel/src/adapters/real/accept-invite-form.tsx). One
 * auth UI in every mode (ADR-0003), same as SignInScreen wrapping RealSignInForm.
 */
export function AcceptInviteShell({
    title,
    lead,
    body,
    testId,
}: {
    title: string
    lead?: ReactNode
    body: ReactNode
    testId?: string
}) {
    return (
        <Container component="main" size="xs" py="xl" data-testid={testId}>
            <Stack gap="md">
                <Title order={1}>{title}</Title>
                {lead}
                <Card withBorder padding="lg" radius="md">
                    {body}
                </Card>
            </Stack>
        </Container>
    )
}

interface AcceptInviteValidState {
    kind: 'valid'
    inviteId: string
    orgName: string
    role: string
    email: string
}

interface AcceptInviteInvalidState {
    kind: 'invalid'
}

export type AcceptInviteState = AcceptInviteValidState | AcceptInviteInvalidState

/**
 * Router-agnostic accept-invitation screen (ADR-0006 twin lives in keel/demo-static): the real
 * product surface the invite email's accept link lands on. `valid` shows who's being invited into
 * which tenant, as what role, and collects the one field a brand-new person can supply — their
 * name; `invalid` covers an unknown or already-consumed invite id, with a way back to sign-in.
 */
export function AcceptInviteScreen({
    state,
    error,
    onAccept,
    onSignIn,
}: {
    state: AcceptInviteState
    error?: string | null
    onAccept: (values: { name: string }) => Promise<void>
    onSignIn: () => void
}) {
    const t = useTranslations('acceptInvite')
    const [busy, setBusy] = useState(false)
    const form = useForm({
        initialValues: { name: '' },
        validate: { name: (value) => (value.trim() ? null : t('nameRequired')) },
    })

    if (state.kind === 'invalid') {
        return (
            <AcceptInviteShell
                title={t('invalidTitle')}
                testId="accept-invalid"
                body={
                    <Stack gap="sm">
                        <Text c="gray.7">{t('invalidBody')}</Text>
                        <Button variant="subtle" onClick={onSignIn} data-testid="accept-signin-link">
                            {t('backToSignIn')}
                        </Button>
                    </Stack>
                }
            />
        )
    }

    return (
        <AcceptInviteShell
            title={t('title', { org: state.orgName })}
            lead={<Text c="gray.7">{t('subtitle', { role: state.role, email: state.email })}</Text>}
            body={
                <form
                    onSubmit={form.onSubmit((values) => {
                        setBusy(true)
                        onAccept({ name: values.name }).finally(() => setBusy(false))
                    })}
                >
                    <Stack>
                        <TextInput
                            label={t('nameLabel')}
                            data-testid="accept-name"
                            required
                            {...form.getInputProps('name')}
                        />
                        <Button type="submit" loading={busy} data-testid="accept-submit">
                            {t('acceptButton')}
                        </Button>
                        {/* Clickwrap notice: joining ALSO records acceptance of the tenant's
                            current agreements, so the assent being manifested must be disclosed here —
                            an acceptance record without notice is not real clickwrap. */}
                        <Text size="xs" c="gray.7" data-testid="accept-agreements-notice">
                            {t('agreementsNotice')}
                        </Text>
                        {error ? <Text c="red.8">{error}</Text> : null}
                    </Stack>
                </form>
            }
        />
    )
}
