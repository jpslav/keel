'use client'

import { Button, Card, Code, Container, Group, Stack, Text, Title } from '@mantine/core'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { scrubEvent } from '../../observability/scrub'

export interface ScrubResult {
    raw: unknown
    scrubbed: unknown
}

/** Simulator Errors tab: proof that Sentry scrubbing (ADR-0010) works without a DSN — client and server. */
export function ErrorsApp({ runServerScenario }: { runServerScenario?: () => Promise<ScrubResult> }) {
    const t = useTranslations('errors')
    const [result, setResult] = useState<ScrubResult | null>(null)

    function throwClientError() {
        try {
            throw new Error('Test error (client) from /dev/errors')
        } catch (err) {
            const base = {
                message: (err as Error).message,
                request: {
                    query_string: 'q=SECRET_QUERY',
                    headers: { authorization: 'Bearer SECRET_TOKEN' },
                },
                user: { id: 'user_123', email: 'user@example.com', ip_address: '203.0.113.7' },
            }
            setResult({ raw: structuredClone(base), scrubbed: scrubEvent(structuredClone(base)) })
        }
    }

    return (
        // No landmark: this screen renders only inside the Simulator <aside>, never as a page.
        <Container size="md" py="xl">
            <Stack gap="lg">
                <Title order={1}>{t('title')}</Title>
                <Text c="gray.7">{t('intro')}</Text>
                <Group gap="sm">
                    <Button data-testid="throw-client-error" onClick={throwClientError}>
                        {t('throwClient')}
                    </Button>
                    {runServerScenario ? (
                        <Button
                            variant="default"
                            data-testid="throw-server-error"
                            onClick={() => {
                                runServerScenario().then(setResult)
                            }}
                        >
                            {t('throwServer')}
                        </Button>
                    ) : null}
                </Group>
                {result ? (
                    <Stack gap="md">
                        <Card withBorder padding="lg" radius="md">
                            <Title order={2} size="h3" mb="sm">
                                {t('rawHeading')}
                            </Title>
                            <Code block data-testid="error-raw">
                                {JSON.stringify(result.raw, null, 2)}
                            </Code>
                        </Card>
                        <Card withBorder padding="lg" radius="md">
                            <Title order={2} size="h3" mb="sm">
                                {t('scrubbedHeading')}
                            </Title>
                            <Code block data-testid="error-scrubbed">
                                {JSON.stringify(result.scrubbed, null, 2)}
                            </Code>
                        </Card>
                        <Text size="sm" c="gray.7">
                            {t('note')}
                        </Text>
                    </Stack>
                ) : (
                    <Text c="gray.7">{t('empty')}</Text>
                )}
            </Stack>
        </Container>
    )
}
