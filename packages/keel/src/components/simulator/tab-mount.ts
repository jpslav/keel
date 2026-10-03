/**
 * How the Simulator panel renders one host `extraTabs` entry. Pure so the rule is unit-testable
 * without a DOM.
 *
 * An ordinary tab exists only while it is the active tab of an expanded panel. A `keepMounted` tab
 * (the Actors tab, whose content runs the actors' tick loops) is LAZY, then STICKY: nothing mounts
 * until it is first opened — so a fresh page, an e2e spec and a tour all start in a quiet world —
 * and from then on it stays mounted, hidden, through tab switches and panel collapse, so the actors
 * keep working while you watch Jobs. It never moves in the DOM: moving an iframe reloads it.
 */
export type TabMount = 'shown' | 'hidden' | 'none'

export function tabMount(
    tab: { id: string; keepMounted?: boolean },
    state: { activeTab: string; collapsed: boolean; visited: ReadonlySet<string> },
): TabMount {
    if (!state.collapsed && state.activeTab === tab.id) return 'shown'
    return tab.keepMounted && state.visited.has(tab.id) ? 'hidden' : 'none'
}
