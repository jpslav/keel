/**
 * How the Simulator panel renders one host `extraTabs` entry. Pure so the rule is unit-testable
 * without a DOM.
 *
 * An ordinary tab exists only while it is the active tab of an expanded panel. A `keepMounted` tab
 * (the Actors tab, whose content runs the actors' tick loops) is mounted from page load and never
 * unmounted — shown when it is the active tab of an expanded panel, hidden otherwise — because the
 * counterparties it hosts are part of the world, and the world doesn't wait for someone to open a
 * tab. (Pausing them is a world switch the host wires in, e.g. the showcase's `actors-held` flag.) It
 * never moves in the DOM either: moving an iframe reloads it.
 */
export type TabMount = 'shown' | 'hidden' | 'none'

export function tabMount(
    tab: { id: string; keepMounted?: boolean },
    state: { activeTab: string; collapsed: boolean },
): TabMount {
    if (!state.collapsed && state.activeTab === tab.id) return 'shown'
    return tab.keepMounted ? 'hidden' : 'none'
}
