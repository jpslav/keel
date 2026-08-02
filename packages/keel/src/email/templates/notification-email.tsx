import { Body, Container, Head, Heading, Html, Preview, Section, Text } from '@react-email/components'

interface NotificationEmailLabels {
    preview: string
    heading: string
    body: string
    footer: string
}

export interface NotificationEmailProps {
    /** All copy arrives pre-localized from the caller's next-intl lookup (`notifications` namespace) —
     *  templates render outside a request context, so they never call next-intl themselves. ONE generic
     *  template serves every NotificationKind; the kind decides only which labels the caller passes. */
    labels: NotificationEmailLabels
}

/**
 * The generic notification email — the `email` fan-out channel. Deliberately ONE template
 * with kind-based copy rather than a template per kind: the channel is the reusable thing, and a new
 * NotificationKind ships copy in the i18n `notifications` namespace, not a new react-email file.
 * Previewed in Ladle, rendered by packages/keel/src/email/send.ts, caught by the Simulator Mail tab.
 */
export function NotificationEmail({ labels }: NotificationEmailProps) {
    return (
        <Html lang="en">
            <Head />
            <Preview>{labels.preview}</Preview>
            <Body style={{ backgroundColor: '#f4f4f5', fontFamily: 'sans-serif' }}>
                <Container style={{ backgroundColor: '#ffffff', borderRadius: 8, margin: '40px auto', padding: 24 }}>
                    <Heading as="h2">{labels.heading}</Heading>
                    <Section>
                        <Text>{labels.body}</Text>
                        <Text style={{ fontSize: 12, color: '#666666' }}>{labels.footer}</Text>
                    </Section>
                </Container>
            </Body>
        </Html>
    )
}
