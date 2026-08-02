import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from '@react-email/components'

interface InviteEmailLabels {
    preview: string
    heading: string
    body: string
    button: string
    linkFallback: string
}

export interface InviteEmailProps {
    /** All copy arrives pre-localized from the caller's next-intl lookup (`email` namespace) —
     *  templates render outside a request context, so they never call next-intl themselves. */
    labels: InviteEmailLabels
    /** Built by the caller (src/app/api/org/invite/route.ts) from the invite id and request origin. */
    acceptUrl: string
}

/**
 * Templates are react-email components (ADR-0011); previewed in Ladle, rendered by
 * packages/keel/src/email/send.ts. `acceptUrl` is the real accept-invitation entrypoint (src/app/[locale]/accept-invite) —
 * the Simulator Mail tab renders this end-to-end (clicks inside the reading pane bridge out to
 * the app's navigation policy; the extracted link rows carry a copy button).
 */
export function InviteEmail({ labels, acceptUrl }: InviteEmailProps) {
    return (
        <Html lang="en">
            <Head />
            <Preview>{labels.preview}</Preview>
            <Body style={{ backgroundColor: '#f4f4f5', fontFamily: 'sans-serif' }}>
                <Container style={{ backgroundColor: '#ffffff', borderRadius: 8, margin: '40px auto', padding: 24 }}>
                    <Heading as="h2">{labels.heading}</Heading>
                    <Section>
                        <Text>{labels.body}</Text>
                        <Section style={{ textAlign: 'center', margin: '24px 0' }}>
                            <Button
                                href={acceptUrl}
                                style={{
                                    backgroundColor: '#4c6ef5',
                                    color: '#ffffff',
                                    borderRadius: 6,
                                    padding: '12px 24px',
                                }}
                            >
                                {labels.button}
                            </Button>
                        </Section>
                        <Text style={{ fontSize: 12, color: '#666666' }}>
                            {`${labels.linkFallback} `}
                            {acceptUrl}
                        </Text>
                    </Section>
                </Container>
            </Body>
        </Html>
    )
}
