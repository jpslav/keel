'use client'

import { Button, Stack, Text } from '@mantine/core'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import type { PendingAgreement } from '../../core/agreements'
import { GateInterstitial } from '../gates/gate-interstitial'
import { AgreementBody } from './agreement-body'

/**
 * The agreements worked example filling the generic gate interstitial: the pending
 * agreement's title + body, and the one action that resolves it — Accept. Router-agnostic and
 * presentational; `onAccept` is supplied by the host (the protected-layout glue POSTs + reloads; the
 * static twin records in memory). One agreement at a time — the layout re-evaluates after each accept,
 * so a second pending block agreement simply appears next.
 */
export function AgreementGate({ agreement, onAccept }: { agreement: PendingAgreement; onAccept: () => Promise<void> }) {
    const t = useTranslations('agreements')
    const [busy, setBusy] = useState(false)

    return (
        <GateInterstitial title={t('gateTitle')}>
            <Stack gap="md" data-testid="agreement-gate">
                <Text fw={600} size="lg">
                    {agreement.title}
                </Text>
                <Text c="gray.7" size="sm">
                    {t('gateLead')}
                </Text>
                <AgreementBody bodyMd={agreement.bodyMd} />
                <Button
                    data-testid="agreement-accept"
                    loading={busy}
                    onClick={() => {
                        setBusy(true)
                        void onAccept().finally(() => setBusy(false))
                    }}
                    style={{ alignSelf: 'start' }}
                >
                    {t('acceptButton')}
                </Button>
            </Stack>
        </GateInterstitial>
    )
}
