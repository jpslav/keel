'use client'

import { Button, Card, Container, List, Stack, Text, Textarea, Title } from '@mantine/core'
import { useTranslations } from 'next-intl'
import { type ReactNode, useState } from 'react'

export interface DashboardUser {
    name: string
    role: string
    restricted: boolean
}

/** What an answered question leaves behind: the tickets the assistant's tools actually read. */
export interface AssistantSources {
    sources: string[]
}

/** Signed-in landing screen; the assistant card exercises the llm port (hidden for restricted members). */
export function DashboardScreen({
    user,
    onAsk,
    children,
}: {
    user: DashboardUser
    /**
     * Ask the assistant. The answer STREAMS: `onDelta` is called with each chunk as it arrives, and the
     * promise resolves once the whole reply has landed, carrying the tickets the tools read. Both the
     * server route and the static twin implement this shape, so the card behaves identically in a
     * `file://` bundle and against a running server.
     */
    onAsk: (question: string, onDelta: (chunk: string) => void) => Promise<AssistantSources>
    /** Extra content rendered below the assistant card, inside the same <main> landmark. */
    children?: ReactNode
}) {
    const t = useTranslations('dashboard')
    const [question, setQuestion] = useState('')
    const [answer, setAnswer] = useState('')
    const [sources, setSources] = useState<string[]>([])
    const [busy, setBusy] = useState(false)

    return (
        <Container component="main" size="sm" py="xl">
            <Stack gap="lg">
                <Title order={1}>{t('title')}</Title>
                <Text c="gray.7" data-testid="signed-in-as">
                    {t('signedInAs', { name: user.name, role: user.role })}
                </Text>
                {!user.restricted && (
                    <Card withBorder padding="lg" radius="md" data-testid="assistant-card">
                        <Stack>
                            <Title order={2} size="h3">
                                {t('assistantTitle')}
                            </Title>
                            <Textarea
                                label={t('assistantLabel')}
                                placeholder={t('assistantPlaceholder')}
                                value={question}
                                onChange={(event) => setQuestion(event.currentTarget.value)}
                                autosize
                                minRows={2}
                            />
                            <Button
                                loading={busy}
                                disabled={!question.trim()}
                                data-testid="ask-button"
                                onClick={() => {
                                    setBusy(true)
                                    // Clear before the first chunk: a streamed answer that appears to
                                    // append to the previous one reads as a single confused reply.
                                    setAnswer('')
                                    setSources([])
                                    onAsk(question, (chunk) => setAnswer((prev) => prev + chunk))
                                        .then((result) => setSources(result.sources))
                                        // A failed ask (network drop, mid-stream abort) must surface,
                                        // not sit as an unhandled rejection behind a blank card.
                                        .catch(() => setAnswer((prev) => prev || t('assistantError')))
                                        .finally(() => setBusy(false))
                                }}
                            >
                                {t('askButton')}
                            </Button>
                            {answer ? (
                                <Text data-testid="assistant-answer" style={{ whiteSpace: 'pre-wrap' }}>
                                    {answer}
                                </Text>
                            ) : null}
                            {sources.length > 0 ? (
                                <Stack gap={4} data-testid="assistant-sources">
                                    <Text size="sm" fw={600}>
                                        {t('assistantSourcesHeading')}
                                    </Text>
                                    <List size="sm" spacing={2}>
                                        {sources.map((source) => (
                                            <List.Item key={source}>{source}</List.Item>
                                        ))}
                                    </List>
                                </Stack>
                            ) : null}
                        </Stack>
                    </Card>
                )}
                {children}
            </Stack>
        </Container>
    )
}
