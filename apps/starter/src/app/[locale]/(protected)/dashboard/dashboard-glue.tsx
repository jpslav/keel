'use client'

import { useEffect, useState } from 'react'
import { DashboardScreen, type DashboardUser } from '@/components/dashboard-screen'
import { ItemsCard, type Item } from '@/components/items-card'

export function DashboardGlue({ user, canCreateItem }: { user: DashboardUser; canCreateItem: boolean }) {
    const [items, setItems] = useState<Item[]>([])

    useEffect(() => {
        // Sets state only once the response lands — the legitimate "sync with an external system"
        // case, so the react-hooks set-state-in-effect rule does not fire here.
        void fetch('/api/items')
            .then((response) => (response.ok ? response.json() : { items: [] }))
            .then((data: { items: Item[] }) => setItems(data.items))
    }, [])

    return (
        <DashboardScreen user={user}>
            <ItemsCard
                items={items}
                canCreate={canCreateItem}
                onAdd={async (title) => {
                    const response = await fetch('/api/items', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ title }),
                    })
                    if (response.ok) {
                        const { item } = (await response.json()) as { item: Item }
                        setItems((prev) => [item, ...prev])
                    }
                }}
            />
        </DashboardScreen>
    )
}
