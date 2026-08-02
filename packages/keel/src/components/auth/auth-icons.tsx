import type { ReactNode } from 'react'

/**
 * Tiny inline stroke icons (Lucide-style paths, MIT) for the auth surfaces. Inline rather than a
 * dependency so the single-file demo stays inside its size budget and dev stays hermetic; they
 * inherit `currentColor` and are aria-hidden (the surrounding control carries the label).
 */
function Glyph({ children, size = 16 }: { children: ReactNode; size?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {children}
        </svg>
    )
}

export function ChevronDownIcon() {
    return (
        <Glyph>
            <path d="m6 9 6 6 6-6" />
        </Glyph>
    )
}

export function CheckIcon() {
    return (
        <Glyph>
            <path d="M20 6 9 17l-5-5" />
        </Glyph>
    )
}

export function UserIcon() {
    return (
        <Glyph>
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
        </Glyph>
    )
}

export function SignOutIcon() {
    return (
        <Glyph>
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="m16 17 5-5-5-5" />
            <path d="M21 12H9" />
        </Glyph>
    )
}

export function BellIcon() {
    return (
        <Glyph size={20}>
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </Glyph>
    )
}
