import type { ReactNode } from 'react'

// Passthrough: the real document shell (html/body, providers) lives in [locale]/layout.tsx
// so the lang attribute can reflect the active locale.
export default function RootLayout({ children }: { children: ReactNode }) {
    return children
}
