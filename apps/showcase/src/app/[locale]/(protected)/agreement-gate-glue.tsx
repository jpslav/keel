'use client'

import { useCallback } from 'react'
import type { PendingAgreement } from 'keel/core/agreements'
import { AgreementGate } from 'keel/components/agreements/agreement-gate'

/**
 * Client glue for the blocking agreement interstitial. The protected layout is an RSC and
 * can't hand a callback across the server/client boundary, so this thin client wrapper owns the accept
 * action: POST /api/agreements/accept, then a full reload so the RSC layout re-evaluates gates on the
 * next render (the acceptance clears the pending gate naturally). Mirrors how header-glue / profile-glue
 * wrap a server-rendered screen with its fetch behavior.
 */
export function AgreementGateGlue({ agreement }: { agreement: PendingAgreement }) {
    const onAccept = useCallback(async () => {
        const response = await fetch('/api/agreements/accept', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ agreementId: agreement.id }),
        })
        if (response.ok) window.location.reload()
    }, [agreement.id])

    return <AgreementGate agreement={agreement} onAccept={onAccept} />
}
