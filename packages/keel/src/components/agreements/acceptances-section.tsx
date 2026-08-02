import { Card, Group, Stack, Text, Title } from '@mantine/core'
import { useTranslations } from 'next-intl'

/** One accepted-agreement row for the profile list (structurally matches packages/keel/src/db/agreements
 *  AcceptanceRecord; declared here so this shared component doesn't import a server module). */
export interface AcceptanceItem {
    agreementId: string
    title: string
    kind: string
    version: number
    acceptedAt: string
}

/**
 * Profile "Agreements you've accepted" section — a read-only record of which agreements and
 * versions the user accepted, and when. Router-agnostic and presentational; the real app feeds it from
 * the DB (server-rendered), the static twin from its in-memory acceptances. Empty state included so the
 * section is honest when nothing has been accepted yet.
 */
export function AcceptancesSection({ acceptances }: { acceptances: AcceptanceItem[] }) {
    const t = useTranslations('agreements')
    return (
        <Card withBorder padding="lg" radius="md" data-testid="acceptances-section">
            <Title order={2} size="h3" mb="md">
                {t('acceptancesTitle')}
            </Title>
            {acceptances.length === 0 ? (
                <Text c="gray.7" size="sm" data-testid="acceptances-empty">
                    {t('acceptancesEmpty')}
                </Text>
            ) : (
                <Stack gap="sm">
                    {acceptances.map((acceptance) => (
                        <Group
                            key={`${acceptance.agreementId}-${acceptance.version}-${acceptance.acceptedAt}`}
                            justify="space-between"
                            wrap="nowrap"
                            data-testid="acceptance-row"
                        >
                            <Text size="sm" fw={500}>
                                {acceptance.title}
                            </Text>
                            <Text size="xs" c="gray.7" style={{ whiteSpace: 'nowrap' }}>
                                {t('acceptanceMeta', {
                                    version: acceptance.version,
                                    date: acceptance.acceptedAt.slice(0, 10),
                                })}
                            </Text>
                        </Group>
                    ))}
                </Stack>
            )}
        </Card>
    )
}
