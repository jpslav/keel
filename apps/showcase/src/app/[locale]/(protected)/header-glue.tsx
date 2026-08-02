'use client'

import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { AppHeader } from 'keel/components/app-header'
import { AppNav } from '@/components/app-nav'
import { OrgSwitcher, type SwitcherOrg } from 'keel/components/auth/org-switcher'
import { UserMenu, type MenuUser } from 'keel/components/auth/user-menu'
import { NotificationBell, type NotificationItem } from 'keel/components/notifications/notification-bell'

/** Product-side poll cadence for the notification bell (the house polling doctrine; simulator uses a
 *  faster panel cadence — 30s is plenty for a product bell, plus a refetch on navigation). */
const NOTIFICATIONS_POLL_MS = 30_000

export function HeaderGlue({
    user,
    orgs,
    activeSlug,
    tenantName,
    locale,
}: {
    user: MenuUser
    orgs: SwitcherOrg[]
    activeSlug: string
    tenantName: string
    locale: string
}) {
    // The product's name comes from THIS app's catalog — the framework's has no default (app-header.tsx).
    const t = useTranslations('welcome')
    const [items, setItems] = useState<NotificationItem[]>([])
    const [unread, setUnread] = useState(0)
    const pathname = usePathname()

    const refresh = useCallback(async () => {
        const response = await fetch('/api/notifications')
        if (!response.ok) return
        const data = (await response.json()) as { items: NotificationItem[]; unread: number }
        setItems(data.items)
        setUnread(data.unread)
    }, [])

    // Fetch on mount and on every SPA navigation (the page-view-tracker usePathname pattern), plus a
    // modest interval poll. Each fires refresh(); the effect cleans up its interval. refresh() sets
    // state only AFTER an awaited fetch — the "sync with an external system" case (dashboard-glue).
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void refresh()
        const id = setInterval(() => void refresh(), NOTIFICATIONS_POLL_MS)
        return () => clearInterval(id)
    }, [refresh, pathname])

    // Mark-all-read on popover open (the recorded decision): clear the badge immediately for feedback,
    // then persist + re-sync. A failed POST just leaves the next poll to correct the optimistic clear.
    const handleOpen = useCallback(() => {
        setUnread(0)
        void fetch('/api/notifications/read', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
        }).then(() => refresh())
    }, [refresh])

    const nav = (
        <AppNav
            onNavigate={(target) =>
                window.location.assign(`/${locale}/${target === 'dashboard' ? 'dashboard' : 'org'}`)
            }
        />
    )

    return (
        <AppHeader
            appName={t('appName')}
            tenantName={tenantName}
            nav={nav}
            bell={<NotificationBell items={items} unread={unread} onOpen={handleOpen} />}
            controls={
                <>
                    <OrgSwitcher
                        orgs={orgs}
                        activeSlug={activeSlug}
                        onSwitch={(orgSlug) => {
                            void fetch('/api/auth/org', {
                                method: 'POST',
                                headers: { 'content-type': 'application/json' },
                                body: JSON.stringify({ orgSlug }),
                            }).then((response) => {
                                if (response.ok) window.location.reload()
                            })
                        }}
                    />
                    <UserMenu
                        user={user}
                        onProfile={() => window.location.assign(`/${locale}/profile`)}
                        onSignOut={() => {
                            void fetch('/api/auth/signout', { method: 'POST' }).then((response) => {
                                if (response.ok) window.location.assign(`/${locale}`)
                            })
                        }}
                    />
                </>
            }
        />
    )
}
