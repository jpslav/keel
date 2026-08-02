import { Body, Container, Head, Heading, Html, Preview, Section, Text } from '@react-email/components'

interface DigestEmailLabels {
    preview: string
    heading: string
    intro: string
    /** Already-localized "You have N items." (count interpolated by the caller — the app names them). */
    countLine: string
    recentHeading: string
    /** Shown instead of the recent list when the team has nothing to digest. */
    emptyLine: string
    footer: string
}

export interface DigestEmailProps {
    /** All copy arrives pre-localized from the caller's next-intl lookup (`email` namespace) —
     *  templates render outside a request context, so they never call next-intl themselves. */
    labels: DigestEmailLabels
    /** Recent item snippets — user DATA, not UI copy, so they pass through verbatim. */
    recentTitles: string[]
}

/**
 * The scheduled org digest, previewed in Ladle, rendered by packages/keel/src/email/send.ts. Structurally
 * a sibling of invite-email.tsx: a `labels` bag of pre-localized strings plus structured data (the
 * recent-item snippets). The Simulator Mail tab renders it end-to-end when a schedule fires.
 */
export function DigestEmail({ labels, recentTitles }: DigestEmailProps) {
    return (
        <Html lang="en">
            <Head />
            <Preview>{labels.preview}</Preview>
            <Body style={{ backgroundColor: '#f4f4f5', fontFamily: 'sans-serif' }}>
                <Container style={{ backgroundColor: '#ffffff', borderRadius: 8, margin: '40px auto', padding: 24 }}>
                    <Heading as="h2">{labels.heading}</Heading>
                    <Section>
                        <Text>{labels.intro}</Text>
                        <Text style={{ fontWeight: 600 }}>{labels.countLine}</Text>
                        {recentTitles.length > 0 ? (
                            <Section>
                                <Text style={{ fontWeight: 600, marginBottom: 4 }}>{labels.recentHeading}</Text>
                                {recentTitles.map((title, index) => (
                                    <Text
                                        // Snippets can repeat, so index-suffix the key (order is stable).
                                        key={`${index}-${title}`}
                                        style={{ margin: '2px 0', color: '#333333' }}
                                    >
                                        {`• ${title}`}
                                    </Text>
                                ))}
                            </Section>
                        ) : (
                            <Text style={{ color: '#666666' }}>{labels.emptyLine}</Text>
                        )}
                        <Text style={{ fontSize: 12, color: '#666666', marginTop: 16 }}>{labels.footer}</Text>
                    </Section>
                </Container>
            </Body>
        </Html>
    )
}
