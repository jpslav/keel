'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { OrgScreen, type OrgMember } from 'keel/components/org-screen'
import { WebhookEndpointsCard, type WebhookEndpointItem } from 'keel/components/webhook-endpoints-card'
import { WEBHOOK_EVENT_KINDS } from 'keel/core/webhook-events'

export function OrgGlue({
    orgName,
    members,
    roles,
    canManage,
}: {
    orgName: string
    members: OrgMember[]
    roles: string[]
    canManage: boolean
}) {
    const t = useTranslations('org')
    const router = useRouter()
    const [error, setError] = useState<string | null>(null)
    const [endpoints, setEndpoints] = useState<WebhookEndpointItem[]>([])
    const [newSecret, setNewSecret] = useState<string | null>(null)

    // Monotonic guard: rapid toggle/delete/create each PATCH-then-refresh concurrently, and an older
    // GET resolving last must not overwrite the newer list on screen.
    const refreshSeq = useRef(0)
    const refreshEndpoints = useCallback(async () => {
        const seq = ++refreshSeq.current
        const response = await fetch('/api/webhook-endpoints')
        if (!response.ok) return
        const data = (await response.json()) as { endpoints: WebhookEndpointItem[] }
        if (seq === refreshSeq.current) setEndpoints(data.endpoints)
    }, [])

    useEffect(() => {
        // Only admins see and manage endpoints (the route also authorize()-gates every mutation).

        if (canManage) void refreshEndpoints()
    }, [canManage, refreshEndpoints])

    return (
        <OrgScreen
            orgName={orgName}
            members={members}
            roles={roles}
            canManage={canManage}
            error={error}
            onInvite={async (invite) => {
                setError(null)
                const response = await fetch('/api/org/invite', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(invite),
                })
                if (!response.ok) {
                    const body = (await response.json().catch(() => ({}))) as { error?: string }
                    setError(body.error === 'duplicate' ? t('inviteDuplicate') : t('inviteFailed'))
                    throw new Error(body.error ?? 'invite failed')
                }
                // The member table is server-rendered; refresh so the new invited row shows up
                // without a manual reload.
                router.refresh()
            }}
        >
            {canManage ? (
                <WebhookEndpointsCard
                    endpoints={endpoints}
                    eventKindOptions={[...WEBHOOK_EVENT_KINDS]}
                    newSecret={newSecret}
                    onDismissSecret={() => setNewSecret(null)}
                    onCreate={async (input) => {
                        const response = await fetch('/api/webhook-endpoints', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify(input),
                        })
                        if (response.ok) {
                            const { secret } = (await response.json()) as { id: string; secret: string }
                            setNewSecret(secret)
                            await refreshEndpoints()
                        }
                    }}
                    onToggle={async (id, enabled) => {
                        const response = await fetch(`/api/webhook-endpoints/${id}`, {
                            method: 'PATCH',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ enabled }),
                        })
                        if (response.ok) await refreshEndpoints()
                    }}
                    onDelete={async (id) => {
                        const response = await fetch(`/api/webhook-endpoints/${id}`, { method: 'DELETE' })
                        if (response.ok) await refreshEndpoints()
                    }}
                />
            ) : null}
        </OrgScreen>
    )
}
