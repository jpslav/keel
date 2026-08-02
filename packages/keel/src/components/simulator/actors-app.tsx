'use client'

import { Box, Group, Stack, Text } from '@mantine/core'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import type { ActorId } from '@app-config/actors'
import { chipStyle } from './people-app'

/**
 * One card's body plus its ALREADY-TRANSLATED label, host-supplied (ADR-0006: this component stays
 * router- and transport-blind — and catalog-blind: WHICH counterparties exist is app vocabulary, so
 * their copy belongs in the app's catalog and arrives here as finished strings, exactly like
 * SimulatorExtraTab.label). The
 * real glue hands over a same-origin iframe src pointing at the actor's own page; the static twin
 * hands over an already-mounted ActorShell node running inline. A discriminated union keeps the two
 * shapes mutually exclusive rather than an always-both-optional prop bag.
 */
export type ActorSlot = { id: ActorId; title: string; description: string } & (
    { iframeSrc: string } | { node: ReactNode }
)

export interface ActorsWorldCounts {
    queued: number
    running: number
    completed: number
}

/**
 * Router-agnostic Simulator Actors tab (ADR-0006 twin lives in keel/demo-static): two labeled cards,
 * one per actor (see src/app-config/actors.ts for the org split), each hosting its own process UI. A
 * compact world strip above the cards reads the SAME cross-tenant job data the Jobs tab shows (held
 * badge + queued/running/completed counts), so an operator can watch the pool drain without
 * switching tabs. The Jobs tab itself stays — this is a live-process view, not a replacement for the
 * full world list.
 */
export function ActorsApp({
    slots,
    world,
}: {
    slots: ActorSlot[]
    world: { held: boolean; counts: ActorsWorldCounts }
}) {
    const t = useTranslations('simulator')

    return (
        <Stack gap="sm" data-testid="simulator-actors">
            <Text size="xs" c="gray.5">
                {t('actorsHint')}
            </Text>
            <Group
                justify="space-between"
                wrap="nowrap"
                gap="xs"
                data-testid="simulator-actors-world"
                style={{ border: '1px solid rgba(255,255,255,0.18)', borderRadius: 8, padding: '6px 10px' }}
            >
                {world.held ? (
                    <Text
                        size="xs"
                        fw={700}
                        data-testid="actors-world-held"
                        style={{ background: '#5c3d00', color: '#ffd43b', borderRadius: 999, padding: '2px 10px' }}
                    >
                        {t('actorsWorldHeld')}
                    </Text>
                ) : (
                    <span />
                )}
                <Text size="xs" c="gray.3" style={chipStyle}>
                    {t('actorsWorldCounts', {
                        queued: world.counts.queued,
                        running: world.counts.running,
                        completed: world.counts.completed,
                    })}
                </Text>
            </Group>
            {slots.map((slot) => (
                <Box
                    key={slot.id}
                    data-testid={`actor-card-${slot.id}`}
                    style={{ border: '1px solid rgba(255,255,255,0.18)', borderRadius: 8, padding: 10 }}
                >
                    <Stack gap={6}>
                        <Stack gap={2}>
                            <Text size="sm" fw={700} c="gray.0">
                                {slot.title}
                            </Text>
                            <Text size="xs" c="gray.5">
                                {slot.description}
                            </Text>
                        </Stack>
                        {'node' in slot ? (
                            slot.node
                        ) : (
                            // These frames are OUR OWN same-origin pages (src/app/[locale]/simulator/actors/
                            // [actor]) that must run their own scripts AND make same-origin fetch calls
                            // (minting a service token, producing an artifact, posting status/webhook
                            // updates) — the opposite trust class from MailApp's reading-pane iframe, which
                            // renders UNTRUSTED caught-email HTML and is deliberately sandboxed to an OPAQUE
                            // origin with only allow-scripts (no allow-same-origin) so that content can never
                            // touch the app's origin, cookies, or fetch. An actor frame is trusted, first-
                            // party code that NEEDS the real origin for fetch()/cookies to work at all, so
                            // `sandbox="allow-scripts"` alone would break it (opaque origin ≠ same origin).
                            // Omitting `sandbox` entirely keeps the frame's privileges identical to a normal
                            // same-origin navigation — nothing gained, nothing given up beyond what a page
                            // already has.
                            <iframe
                                title={t('actorFrameTitle', { actor: slot.id })}
                                src={slot.iframeSrc}
                                data-testid={`actor-frame-${slot.id}`}
                                style={{ width: '100%', height: 320, border: 0, borderRadius: 6, background: '#111' }}
                            />
                        )}
                    </Stack>
                </Box>
            ))}
        </Stack>
    )
}
