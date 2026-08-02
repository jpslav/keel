import { Card, Container, Stack, Title } from '@mantine/core'
import type { ReactNode } from 'react'

/**
 * The GENERIC blocking-gate resolution shell — the reusable UI half of the gate seam
 * (packages/keel/src/core/gates.ts). Domain-agnostic: it lays out a gate's title and a content slot (the resolution
 * flow itself). The worked example fills it with an agreement body + accept button
 * (packages/keel/src/components/agreements/agreement-gate.tsx); a future rider (MFA enrollment, onboarding) supplies
 * its own content here with no change to this shell. Router-agnostic and hook-free, so it renders
 * identically in the real app and the static-demo twin (ADR-0006). Mirrors the AcceptInviteShell shape.
 */
export function GateInterstitial({ title, children }: { title: string; children: ReactNode }) {
    return (
        <Container component="main" size="sm" py="xl" data-testid="gate-interstitial">
            <Stack gap="md">
                <Title order={1}>{title}</Title>
                <Card withBorder padding="lg" radius="md">
                    {children}
                </Card>
            </Stack>
        </Container>
    )
}
