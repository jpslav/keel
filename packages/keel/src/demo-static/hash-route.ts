import { useEffect, useState } from 'react'

/**
 * The static demo's router (ADR-0006). App Router client navigation cannot run from `file://`, so the
 * demo shell is ONE entry point that reads the location hash and picks a screen — which is why every
 * screen in this codebase is router-agnostic in the first place. Deliberately not a router library:
 * the whole contract is "a string, and a way to change it".
 */

/** The current route: the hash with its leading `#/` stripped (so the welcome route is `''`). */
export function useHashRoute(): string {
    const [route, setRoute] = useState(() => window.location.hash.replace(/^#\/?/, ''))
    useEffect(() => {
        const onChange = () => setRoute(window.location.hash.replace(/^#\/?/, ''))
        window.addEventListener('hashchange', onChange)
        return () => window.removeEventListener('hashchange', onChange)
    }, [])
    return route
}

/** Navigate. Setting the hash fires `hashchange`, which every mounted useHashRoute picks up. */
export function go(route: string) {
    window.location.hash = `#/${route}`
}
