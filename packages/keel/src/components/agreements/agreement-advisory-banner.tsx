'use client'

import { Alert } from '@mantine/core'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import type { PendingAgreement } from '../../core/agreements'

/**
 * Advisory agreement banner: the non-blocking half of the gate seam. Where a blocking
 * agreement renders the full interstitial instead of the app, an ADVISORY one passes through and shows
 * this dismissible banner above the app (the demo-banner precedent) — the actor may proceed. Dismiss is
 * local (session) state; it reappears on a full reload, which is the right posture for an advisory
 * notice. Lists the pending advisory agreement titles (world content, passed as a param).
 */
export function AgreementAdvisoryBanner({ agreements }: { agreements: PendingAgreement[] }) {
    const t = useTranslations('agreements')
    const [dismissed, setDismissed] = useState(false)
    if (dismissed || agreements.length === 0) return null
    const titles = agreements.map((agreement) => agreement.title).join(', ')
    return (
        <Alert
            variant="light"
            color="yellow"
            radius={0}
            withCloseButton
            closeButtonLabel={t('advisoryDismiss')}
            onClose={() => setDismissed(true)}
            data-testid="agreement-advisory-banner"
        >
            {t('advisoryBanner', { titles })}
        </Alert>
    )
}
