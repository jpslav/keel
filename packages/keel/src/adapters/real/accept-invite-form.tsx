'use client'

import { useSignUp } from '@clerk/nextjs'
import { Stack, Text } from '@mantine/core'
import { useEffect, useState } from 'react'

/**
 * Clerk ticket-strategy sign-up (ADR-0003): at cutover, Clerk organization invitations carry a
 * `__clerk_ticket` query param onto this page's URL instead of the fake email's plain
 * `/accept-invite?invite=<id>` link. sign-in-form.tsx is the reference for the v7 signals API
 * (signIn.password() → status → finalize()) — the sign-up equivalent used here is
 * signUp.ticket() → status → finalize(), per @clerk/shared's SignUpFutureResource.
 *
 * AUTHORED — CUTOVER (`auth-dev`): never run against a real Clerk instance. Verify the full
 * ticket round-trip once a dev Clerk instance issues real invitation tickets (see
 * docs/cutover-checklist.md, `auth-dev` row).
 *
 * Lives in packages/keel/src/adapters because it imports the vendor SDK; the AcceptInviteShell renders it as a
 * slot, and all copy arrives via `labels` from the page's next-intl lookup (same contract as
 * RealSignInForm — one auth UI, no vendor-side strings).
 */
export function RealAcceptInviteForm({
    ticket,
    redirectTo,
    labels,
}: {
    ticket: string | null
    redirectTo: string
    labels: AcceptInviteTicketLabels
}) {
    const { signUp, fetchStatus } = useSignUp()
    const [error, setError] = useState<string | null>(null)
    const [accepted, setAccepted] = useState(false)

    useEffect(() => {
        if (!ticket) return
        // Driving an external SDK call on mount (Clerk's ticket-strategy sign-up) is the
        // legitimate "sync with an external system" case the set-state-in-effect rule guards —
        // same as the Simulator glue's fetch-on-mount effects.
        void (async () => {
            const { error: ticketError } = await signUp.ticket({ ticket })
            if (ticketError) {
                setError(labels.genericError)
                return
            }
            if (signUp.status === 'complete') {
                const finalized = await signUp.finalize()
                if (finalized.error) {
                    setError(labels.genericError)
                    return
                }
                setAccepted(true)
                window.location.assign(redirectTo)
            } else {
                setError(labels.genericError)
            }
        })()
    }, [ticket, signUp, redirectTo, labels.genericError])

    if (!ticket) return <Text c="gray.7">{labels.missingTicket}</Text>

    return (
        <Stack gap="sm">
            {!accepted && !error ? (
                <Text c="gray.7">{fetchStatus === 'fetching' ? labels.accepting : labels.oneMoment}</Text>
            ) : null}
            {error ? <Text c="red.8">{error}</Text> : null}
        </Stack>
    )
}

export interface AcceptInviteTicketLabels {
    missingTicket: string
    accepting: string
    oneMoment: string
    genericError: string
}
