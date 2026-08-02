'use client'

import { ClerkProvider } from '@clerk/nextjs'
import type { ReactNode } from 'react'

/**
 * Real-mode client providers. Only mounted when APP_MODE=real, so simulated mode ships zero Clerk
 * code. AUTHORED — CUTOVER (`auth-dev`).
 */
export function RealAuthProviders({ children }: { children: ReactNode }) {
    return <ClerkProvider>{children}</ClerkProvider>
}
