'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { AcceptInviteScreen, type AcceptInviteState } from 'keel/components/auth/accept-invite-screen'

export function AcceptInviteGlue({ locale, state }: { locale: string; state: AcceptInviteState }) {
    const t = useTranslations('acceptInvite')
    const [error, setError] = useState<string | null>(null)

    async function handleAccept(values: { name: string }) {
        if (state.kind !== 'valid') return
        setError(null)
        const response = await fetch('/api/auth/accept-invite', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            // locale rides along so the new person starts life in the language they accepted in.
            body: JSON.stringify({ inviteId: state.inviteId, name: values.name, locale }),
        })
        if (response.ok) {
            window.location.assign(`/${locale}/dashboard`)
            return
        }
        setError(t('acceptError'))
    }

    return (
        <AcceptInviteScreen
            state={state}
            error={error}
            onAccept={handleAccept}
            onSignIn={() => window.location.assign(`/${locale}/signin`)}
        />
    )
}
