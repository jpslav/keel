'use client'

import { Alert } from '@mantine/core'
import { useTranslations } from 'next-intl'

/** Presentational banner gated by the demo-banner feature flag (analytics port). */
export function DemoBanner() {
    const t = useTranslations('banner')
    return (
        <Alert variant="light" color="blue" radius={0} data-testid="demo-banner-flag">
            {t('demo')}
        </Alert>
    )
}
