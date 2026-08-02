'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Fires a page_view beacon on every SPA navigation (the protected layout is a Server Component
 * that doesn't re-run on client-side route changes, so this is the only place that sees them all).
 */
export function PageViewTracker() {
    const pathname = usePathname()

    useEffect(() => {
        void fetch('/api/analytics/page-view', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: pathname }),
            // keepalive lets the beacon finish even when the user navigates away immediately,
            // so a fast route change doesn't drop (or ECONNRESET) the capture mid-flight.
            keepalive: true,
        })
    }, [pathname])

    return null
}
