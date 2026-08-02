'use client'

import { Badge } from '@mantine/core'
import { useTranslations } from 'next-intl'

/** Fixed corner badge every DEMO_MODE page shows — demo builds must be unmistakable. */
export function DemoBadge() {
    const t = useTranslations('shell')
    return (
        <Badge
            color="orange"
            variant="filled"
            radius="sm"
            data-testid="demo-badge"
            style={{ position: 'fixed', bottom: 12, right: 12, zIndex: 1000 }}
        >
            {t('demoBadge')}
        </Badge>
    )
}
